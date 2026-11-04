import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Pi sub-agents, worktrees and panes in herdr. `subagent_launch` starts an
 * agent and returns at once; when it settles, its final reply and cost arrive
 * in this session as a message that starts a turn. Launches are recorded as
 * session entries, so a reload re-attaches to agents that are still running.
 */

const LAUNCH_ENTRY = "subagent-launch";
const REPORTED_ENTRY = "subagent-reported";
const REPLY_LIMIT = 6000;
const REPORT_REPLY_LINES = 15;
const REPORT_REPLY_CHARS = 2500;
const BATCH_WINDOW_MS = 60_000;
const DEV_SERVER_COMMAND = /\bship\s+up\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev\b|\bvite(?:\s+dev)?\b/;
const DEV_SERVER_START_TIMEOUT_MS = 180_000;
const FINAL_REPLY_CONTRACT =
	"\n\nFinal reply: at most 10 lines: what changed, what is left, and any decision for whoever launched you. They see your commits, diff and PR without you listing them.";
const SUB_AGENT_ENV = ["PLANNOTATOR_INBOX_TOOL=0", "PLANNOTATOR_AGENT_TOOL=0", "PI_SUBAGENT=1"];
const SHOT_PATTERN = /\bpnpm\s+(?:-s\s+)?shot\b|\bshot\s+(?:publish|outline|flow)\b/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const WORKTREE_PLUGIN = "ship";

interface Launch {
	name: string;
	pane: string;
	cwd: string;
	model?: string;
	thinking?: string;
	session?: string;
	keepOpen: boolean;
	orchestrator?: boolean;
	group?: string;
	headAtLaunch?: string;
	launchedAt: number;
}

interface WorkFacts {
	branch?: string;
	commits: string[];
	shortstat?: string;
	uncommittedFiles: number;
	pr?: { url: string; state: string; checks: string };
}

interface Stats {
	costUsd: number;
	turns: number;
	outputTokens: number;
	shotRuns: number;
	imageReads: number;
	durationMs: number;
}

interface Report {
	name: string;
	outcome: "done" | "error" | "stopped";
	reply: string;
	session?: string;
	stats?: Stats;
	error?: string;
	facts?: WorkFacts;
}

type HerdrJson = { result?: any };

function herdr(args: string[], timeoutMs = 60_000): Promise<HerdrJson> {
	return new Promise((resolve, reject) => {
		execFile("herdr", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`herdr ${args.slice(0, 2).join(" ")}: ${(stderr || error.message).trim()}`));
				return;
			}
			resolve(stdout.trim() ? JSON.parse(stdout) : {});
		});
	});
}

function herdrText(args: string[], timeoutMs = 60_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("herdr", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) reject(new Error(`herdr ${args.slice(0, 2).join(" ")}: ${(stderr || error.message).trim()}`));
			else resolve(stdout);
		});
	});
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", ["-C", cwd, ...args], (error, stdout, stderr) => {
			if (error) reject(new Error(`git ${args[0]}: ${(stderr || error.message).trim()}`));
			else resolve(stdout.trim());
		});
	});
}

function reply<T extends object>(result: T) {
	return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 1) }], structuredContent: result, details: result };
}

function currentWorkspace(): string {
	const workspace = process.env.HERDR_WORKSPACE_ID;
	if (process.env.HERDR_ENV !== "1" || !workspace) throw new Error("not running inside herdr");
	return workspace;
}

async function callerPane(): Promise<{ pane: string; tab: string; workspace: string }> {
	const fallbackWorkspace = currentWorkspace();
	const paneId = process.env.HERDR_PANE_ID ?? "";
	const found = await herdr(["pane", "get", paneId]).then((r) => r.result?.pane, () => undefined);
	return {
		pane: paneId,
		tab: found?.tab_id ?? process.env.HERDR_TAB_ID ?? "",
		workspace: found?.workspace_id ?? fallbackWorkspace,
	};
}

function isInside(directory: string, root: string): boolean {
	return directory === root || directory.startsWith(root.endsWith("/") ? root : `${root}/`);
}

export async function workspaceContainingCwd(cwd: string): Promise<string | undefined> {
	const directory = await realpath(cwd).catch(() => cwd);
	const workspaces = (await herdr(["workspace", "list"])).result.workspaces as any[];
	const candidates = await Promise.all(
		workspaces
			.filter((w) => typeof w.worktree?.checkout_path === "string")
			.map(async (w) => ({ workspace: w.workspace_id as string, root: await realpath(w.worktree.checkout_path).catch(() => w.worktree.checkout_path as string) })),
	);
	return candidates
		.filter(({ root }) => isInside(directory, root))
		.sort((left, right) => right.root.length - left.root.length)[0]?.workspace;
}

async function tabsOfWorkspace(workspace: string): Promise<any[]> {
	return (await herdr(["tab", "list", "--workspace", workspace])).result.tabs as any[];
}

async function panesOfWorkspace(workspace: string): Promise<any[]> {
	return (await herdr(["pane", "list", "--workspace", workspace])).result.panes as any[];
}

async function claimRootPane(cwd: string, branch: string): Promise<string | undefined> {
	const configDir = await herdrText(["plugin", "config-dir", WORKTREE_PLUGIN]).then((s) => s.trim(), () => "");
	if (!configDir) return undefined;
	const root = await realpath(dirname(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
	const claim = join(configDir, "claimed", createHash("sha1").update(`${root}\n${branch}`).digest("hex"));
	await mkdir(dirname(claim), { recursive: true });
	await writeFile(claim, new Date().toISOString());
	return claim;
}

async function agentInfo(name: string): Promise<any | undefined> {
	try {
		return (await herdr(["agent", "get", name])).result?.agent;
	} catch {
		return undefined;
	}
}

/** Splits the largest pane of the tab, across its longer side (a cell is about twice as tall as wide). */
async function splitTarget(anyPaneInTab: string): Promise<{ pane: string; direction: "right" | "down" }> {
	const layout = (await herdr(["pane", "layout", "--pane", anyPaneInTab])).result.layout;
	const largest = [...layout.panes].sort(
		(a: any, b: any) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
	)[0];
	return {
		pane: largest.pane_id,
		direction: largest.rect.width > largest.rect.height * 2.2 ? "right" : "down",
	};
}

async function splitInTab({ anyPaneInTab, cwd, env }: { anyPaneInTab: string; cwd: string; env: string[] }): Promise<string> {
	const target = await splitTarget(anyPaneInTab);
	const split = await herdr([
		"pane", "split", target.pane, "--direction", target.direction, "--cwd", cwd, ...env, "--no-focus",
	]);
	return split.result.pane.pane_id;
}

async function openPaneInLabelledTab({ workspace, cwd, label, env }: { workspace: string; cwd: string; label: string; env: string[] }): Promise<string> {
	const tab = (await tabsOfWorkspace(workspace)).find((t) => t.label === label);
	if (!tab) {
		const created = await herdr(["tab", "create", "--workspace", workspace, "--label", label, "--cwd", cwd, ...env, "--no-focus"]);
		return created.result.root_pane.pane_id;
	}
	const inTab = (await panesOfWorkspace(workspace)).find((p) => p.tab_id === tab.tab_id);
	if (!inTab) throw new Error(`tab ${label} has no panes`);
	return splitInTab({ anyPaneInTab: inTab.pane_id, cwd, env });
}

async function placePane({
	cwd,
	tab,
	workspace,
	otherWorktreeTab,
	envVars = [],
}: {
	cwd: string;
	tab?: string;
	workspace?: string;
	otherWorktreeTab: string;
	envVars?: string[];
}): Promise<{ pane: string; workspace: string }> {
	const env = envVars.flatMap((kv) => ["--env", kv]);
	const caller = await callerPane();
	const target = workspace ?? (await workspaceContainingCwd(cwd)) ?? caller.workspace;
	if (tab) return { pane: await openPaneInLabelledTab({ workspace: target, cwd, label: tab, env }), workspace: target };
	if (target === caller.workspace && caller.pane)
		return { pane: await splitInTab({ anyPaneInTab: caller.pane, cwd, env }), workspace: target };
	return { pane: await openPaneInLabelledTab({ workspace: target, cwd, label: otherWorktreeTab, env }), workspace: target };
}

function commandOutput(command: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim()),
		);
	});
}

const passedCheck = /^(SUCCESS|NEUTRAL|SKIPPED)$/;
const failedCheck = /^(FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$/;

export function checksSummary(rollup: ReadonlyArray<{ conclusion?: string; state?: string }>): string {
	if (rollup.length === 0) return "no checks";
	const outcomes = rollup.map((check) => (check.conclusion || check.state || "").toUpperCase());
	const failed = outcomes.filter((outcome) => failedCheck.test(outcome)).length;
	const passed = outcomes.filter((outcome) => passedCheck.test(outcome)).length;
	const pending = outcomes.length - failed - passed;
	return [failed && `${failed} failed`, pending && `${pending} pending`, passed && `${passed} passed`].filter(Boolean).join(", ");
}

async function workFacts(cwd: string, headAtLaunch: string | undefined): Promise<WorkFacts | undefined> {
	const head = await commandOutput("git", ["rev-parse", "HEAD"], cwd);
	if (!head) return undefined;
	const [branch, status, prJson] = await Promise.all([
		commandOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
		commandOutput("git", ["status", "--porcelain"], cwd),
		commandOutput("gh", ["pr", "view", "--json", "url,state,statusCheckRollup"], cwd),
	]);
	const range = headAtLaunch && headAtLaunch !== head ? `${headAtLaunch}..HEAD` : undefined;
	const [log, shortstat] = range
		? await Promise.all([
				commandOutput("git", ["log", "--oneline", "--max-count=10", range], cwd),
				commandOutput("git", ["diff", "--shortstat", range], cwd),
			])
		: [undefined, undefined];
	let pr: WorkFacts["pr"];
	try {
		const parsed = prJson ? JSON.parse(prJson) : undefined;
		if (parsed?.url) pr = { url: parsed.url, state: parsed.state, checks: checksSummary(parsed.statusCheckRollup ?? []) };
	} catch {
		pr = undefined;
	}
	return {
		branch,
		commits: log ? log.split("\n").filter(Boolean) : [],
		shortstat: shortstat || undefined,
		uncommittedFiles: status ? status.split("\n").filter(Boolean).length : 0,
		pr,
	};
}

export function factsLines(facts: WorkFacts): string[] {
	const commitLine =
		facts.commits.length === 0
			? "Commits since launch: none"
			: `Commits since launch (${facts.commits.length}${facts.commits.length === 10 ? "+" : ""}): ${facts.commits.join("; ")}`;
	return [
		`Branch: ${facts.branch ?? "unknown"}${facts.shortstat ? ` · ${facts.shortstat}` : ""} · ${facts.uncommittedFiles} uncommitted files`,
		commitLine,
		facts.pr ? `PR: ${facts.pr.url} (${facts.pr.state.toLowerCase()}, checks: ${facts.pr.checks})` : "PR: none",
	];
}

export function cappedReply(reply: string, name: string): string {
	const lines = reply.trim().split("\n");
	const kept = lines.slice(0, REPORT_REPLY_LINES).join("\n").slice(0, REPORT_REPLY_CHARS);
	const cut = lines.length > REPORT_REPLY_LINES || kept.length < lines.slice(0, REPORT_REPLY_LINES).join("\n").length;
	return cut ? `${kept}\n… (full reply: subagent_status({ name: "${name}" }))` : kept;
}

export async function devServerUrl(cwd: string): Promise<string | undefined> {
	const root = await commandOutput("git", ["rev-parse", "--show-toplevel"], cwd);
	const listed = await commandOutput("ship", ["ls", "--json", "--no-pr"], cwd);
	if (!root || !listed) return undefined;
	try {
		const entries = JSON.parse(listed) as Array<{ path?: string; proxyDomain?: string }>;
		const rootPath = await realpath(root).catch(() => root);
		const entry = (
			await Promise.all(entries.map(async (e) => ({ e, path: e.path ? await realpath(e.path).catch(() => e.path!) : undefined })))
		).find(({ path }) => path === rootPath)?.e;
		return entry?.proxyDomain ? `https://${entry.proxyDomain}` : undefined;
	} catch {
		return undefined;
	}
}

export async function isServing(url: string): Promise<boolean> {
	const code = await commandOutput("curl", ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url], "/", 10_000);
	const status = Number(code);
	return status > 0 && status < 500;
}

const shellNames = new Set(["zsh", "bash", "fish", "sh", "-zsh", "-bash", "-fish"]);

async function paneAtShellPrompt(pane: string): Promise<boolean> {
	const info = await herdr(["pane", "process-info", "--pane", pane]).then((r) => r.result?.process_info, () => undefined);
	const processes = (info?.foreground_processes ?? []) as Array<{ name?: string }>;
	return processes.length > 0 && processes.every((p) => shellNames.has(p.name ?? ""));
}

async function ensureDevServer({ cwd, workspace }: { cwd: string; workspace?: string }): Promise<{ url?: string; pane?: string; started: boolean }> {
	const caller = await callerPane();
	const target = workspace ?? (await workspaceContainingCwd(cwd)) ?? caller.workspace;
	const url = await devServerUrl(cwd);
	const existingPane = await devTabPane(target);
	if (url && (await isServing(url))) return { url, pane: existingPane, started: false };
	const pane = existingPane ?? (await openPaneInLabelledTab({ workspace: target, cwd, label: "dev", env: [] }));
	if (await paneAtShellPrompt(pane)) await herdr(["pane", "run", pane, "ship up"]);
	if (!url) return { url: undefined, pane, started: true };
	const deadline = Date.now() + DEV_SERVER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isServing(url)) return { url, pane, started: true };
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	throw new Error(`the dev server at ${url} did not answer within ${DEV_SERVER_START_TIMEOUT_MS / 1000}s; read pane ${pane}`);
}

async function devTabPane(workspace: string): Promise<string | undefined> {
	const tab = (await tabsOfWorkspace(workspace)).find((t) => t.label === "dev");
	if (!tab) return undefined;
	return (await panesOfWorkspace(workspace)).find((p) => p.tab_id === tab.tab_id)?.pane_id;
}

export async function summarize(sessionPath: string): Promise<{ reply: string; stats: Stats; error?: string }> {
	const lines = (await readFile(sessionPath, "utf8")).split("\n").filter(Boolean);
	const stats: Stats = { costUsd: 0, turns: 0, outputTokens: 0, shotRuns: 0, imageReads: 0, durationMs: 0 };
	let reply = "";
	let error: string | undefined;
	let first: number | undefined;
	let last: number | undefined;
	for (const line of lines) {
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
		if (!Number.isNaN(at)) {
			first ??= at;
			last = at;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			stats.turns++;
			stats.costUsd += message.usage?.cost?.total ?? 0;
			stats.outputTokens += message.usage?.output ?? 0;
			const parts: any[] = Array.isArray(message.content) ? message.content : [];
			for (const part of parts) {
				if (part.type === "toolCall" && SHOT_PATTERN.test(JSON.stringify(part.arguments ?? {}))) stats.shotRuns++;
			}
			const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
			if (text) reply = text;
			error = message.stopReason === "error" ? message.errorMessage ?? "agent stopped with an error" : undefined;
		} else if (message.role === "toolResult" && Array.isArray(message.content)) {
			stats.imageReads += message.content.filter((p: any) => p.type === "image").length;
		}
	}
	stats.durationMs = first !== undefined && last !== undefined ? last - first : 0;
	return { reply, stats, error };
}

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const minutes = Math.round(ms / 60_000);
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatStats(stats: Stats): string {
	return [
		formatDuration(stats.durationMs),
		`$${stats.costUsd.toFixed(2)}`,
		`${stats.turns} turns`,
		`${Math.round(stats.outputTokens / 1000)}k output`,
		`${stats.shotRuns} shot runs`,
		`${stats.imageReads} images read`,
	].join(" · ");
}

function truncate(text: string): string {
	return text.length <= REPLY_LIMIT ? text : `${text.slice(0, REPLY_LIMIT)}\n… (truncated; full reply in the session file)`;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT === "1") return;
	const launches = new Map<string, Launch>();
	const reports = new Map<string, Report>();
	const watchers = new Map<string, ChildProcess>();

	const orchestratorsWorking = new Set<string>();
	const pending: Array<{ launch: Launch; report: Report }> = [];
	let batchTimer: ReturnType<typeof setTimeout> | undefined;

	const watch = (
		launch: Launch,
		args: string[],
		{ onSuccess = () => void finish(launch), onFailure }: { onSuccess?: () => void; onFailure?: () => void } = {},
	) => {
		const child = spawn("herdr", args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (chunk) => (stderr += chunk));
		watchers.set(launch.name, child);
		child.on("exit", (code, signal) => {
			if (watchers.get(launch.name) !== child) return;
			watchers.delete(launch.name);
			if (signal) return;
			if (code === 0) onSuccess();
			else if (onFailure) onFailure();
			else void finish(launch, stderr.trim() || `herdr exited with ${code}`);
		});
	};

	const settleWatch = (launch: Launch) => {
		if (launch.orchestrator) orchestratorsWorking.add(launch.name);
		watch(launch, ["agent", "wait", launch.name]);
	};

	const wakeWatch = (launch: Launch) =>
		watch(launch, ["agent", "wait", launch.name, "--until", "working"], {
			onSuccess: () => settleWatch(launch),
			onFailure: () => {},
		});

	const isRunning = (launch: Launch) =>
		launch.orchestrator ? orchestratorsWorking.has(launch.name) : !reports.has(launch.name);

	const reportBlock = ({ launch, report }: { launch: Launch; report: Report }) => {
		const verb = report.outcome !== "done" ? "failed" : launch.orchestrator ? "settled (still running)" : "finished";
		const head = `${launch.orchestrator ? "Orchestrator" : "Sub-agent"} ${launch.name} ${verb}${report.stats ? `: ${formatStats(report.stats)}` : ""}`;
		const where = `Session: ${report.session ?? "unknown"}${!launch.keepOpen && report.outcome === "done" ? " (pane closed)" : ` (pane ${launch.pane} open)`}`;
		return [
			head,
			where,
			...(report.error ? [`Error: ${report.error}`] : []),
			...(report.facts ? factsLines(report.facts) : []),
			"",
			report.reply ? cappedReply(report.reply, launch.name) : "(no reply)",
		].join("\n");
	};

	const deliver = (items: Array<{ launch: Launch; report: Report }>) => {
		if (items.length === 0) return;
		const group = items[0].launch.group;
		const heading = items.length > 1 ? `${items.length} sub-agents finished${group ? ` (tab ${group})` : ""}\n\n` : "";
		const body = heading + items.map(reportBlock).join("\n\n");
		const details = items.length === 1 ? items[0].report : { reports: items.map((item) => item.report) };
		for (const { report } of items) pi.appendEntry(REPORTED_ENTRY, { name: report.name, outcome: report.outcome });
		pi.sendMessage(
			{ customType: "subagent-done", content: body, display: true, details },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	};

	const takePending = (belongs: (launch: Launch) => boolean) => {
		const taken = pending.filter((item) => belongs(item.launch));
		for (const item of taken) pending.splice(pending.indexOf(item), 1);
		return taken;
	};

	const flushUngrouped = () => {
		if (batchTimer) clearTimeout(batchTimer);
		batchTimer = undefined;
		deliver(takePending((launch) => !launch.group));
	};

	const queue = (launch: Launch, report: Report) => {
		if (launch.orchestrator) return deliver([{ launch, report }]);
		pending.push({ launch, report });
		const others = [...launches.values()].filter((other) => !other.orchestrator && isRunning(other));
		for (const group of new Set(pending.map((item) => item.launch.group).filter((g): g is string => !!g)))
			if (!others.some((other) => other.group === group)) deliver(takePending((l) => l.group === group));
		if (!pending.some((item) => !item.launch.group)) return;
		if (!others.some((other) => !other.group)) return flushUngrouped();
		batchTimer ??= setTimeout(flushUngrouped, BATCH_WINDOW_MS);
	};

	const finish = async (launch: Launch, failure?: string) => {
		if (!launch.orchestrator && reports.has(launch.name)) return;
		orchestratorsWorking.delete(launch.name);
		const session = launch.session ?? (await agentInfo(launch.name))?.agent_session?.value;
		let report: Report = { name: launch.name, outcome: failure ? "error" : "done", reply: "", session, error: failure };
		if (session) {
			try {
				const summary = await summarize(session);
				report = {
					...report,
					reply: summary.reply,
					stats: summary.stats,
					outcome: failure || summary.error ? "error" : "done",
					error: failure ?? summary.error,
				};
			} catch (error) {
				report.error = `${failure ? `${failure}; ` : ""}session unreadable: ${(error as Error).message}`;
			}
		}
		report.facts = await workFacts(launch.cwd, launch.headAtLaunch).catch(() => undefined);
		reports.set(launch.name, report);
		if (!launch.keepOpen && report.outcome === "done") await herdr(["pane", "close", launch.pane]).catch(() => {});
		if (launch.orchestrator && report.outcome === "done") wakeWatch(launch);
		queue(launch, report);
	};

	const reattach = async (launch: Launch, alreadyReported: boolean) => {
		const agent = await agentInfo(launch.name);
		if (!agent || agent.pane_id !== launch.pane) {
			if (!alreadyReported) void finish(launch, agent || launch.session ? undefined : "agent no longer running");
			return;
		}
		if (agent.agent_status === "working") settleWatch(launch);
		else if (alreadyReported) wakeWatch(launch);
		else void finish(launch);
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		launches.clear();
		reports.clear();
		const reported = new Map<string, Report["outcome"]>();
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry.type !== "custom") continue;
			if (entry.customType === LAUNCH_ENTRY) launches.set(entry.data.name, entry.data);
			if (entry.customType === REPORTED_ENTRY) reported.set(entry.data.name, entry.data.outcome);
		}
		if (process.env.HERDR_ENV !== "1") return;
		for (const launch of launches.values()) {
			const outcome = reported.get(launch.name);
			if (outcome) reports.set(launch.name, { name: launch.name, outcome, reply: "", session: launch.session });
			if (!outcome) void reattach(launch, false);
			else if (launch.orchestrator && outcome === "done") void reattach(launch, true);
		}
	});

	pi.on("cache_warming_decision", (_event, ctx) => {
		if ([...launches.values()].some(isRunning)) return { action: "warm" as const };
		if (ctx.isIdle()) return { action: "stop" as const };
		return undefined;
	});

	pi.on("session_shutdown", async () => {
		for (const child of watchers.values()) child.kill();
		watchers.clear();
		if (batchTimer) clearTimeout(batchTimer);
		batchTimer = undefined;
		pending.splice(0);
	});

	const namespace = {
		name: "herdr",
		description:
			"Herdr: pi sub-agents and orchestrators, git worktrees (each its own herdr workspace, set up by the ship plugin), and panes. Sub-agent completion arrives as a message; never wait or poll for it.",
	};

	pi.registerTool(
		defineTool({
			name: "subagent_launch",
			label: "Launch sub-agent",
			description:
				"Start a pi agent and send it a brief. Its pane goes to the workspace whose checkout holds cwd: next to you when that is your workspace, else split into that worktree's agent tab; tab groups agents in a tab of that name (one per reviewer set, say). Focus is kept. pane starts it in an existing shell pane such as worktree_create's rootPane. Returns at once. When it settles you get one message with its commits, diff, uncommitted files, PR and checks, and its reply capped at 15 lines; agents sharing a tab report together when the last settles, others that settle within 60 s are batched. Its pane closes unless keepOpen. A sub-agent has the Plannotator Inbox and these tools off; an orchestrator keeps both, its pane stays open, and it reports each time it settles.",
			parameters: Type.Object({
				name: Type.String({ description: "Unique herdr agent name, [a-z][a-z0-9_-]{0,31}; also pi's session name" }),
				cwd: Type.String({ description: "Absolute working directory" }),
				model: Type.Optional(Type.String({ description: "pi --model, e.g. anthropic/claude-sonnet-5-5; default the user's" })),
				thinking: Type.Optional(Type.String({ description: "pi --thinking: off|minimal|low|medium|high|xhigh|max; default the user's" })),
				briefFile: Type.Optional(Type.String({ description: "Path of the brief to send; or pass prompt" })),
				prompt: Type.Optional(Type.String({ description: "Brief text; or pass briefFile" })),
				tab: Type.Optional(Type.String({ description: "Group: a tab of this name holds the agent; default none, next to you" })),
				workspace: Type.Optional(Type.String({ description: "Override the workspace; default the one whose checkout holds cwd" })),
				pane: Type.Optional(Type.String({ description: "Existing shell pane at its prompt to start in, e.g. a worktree's rootPane; orchestrators only" })),
				orchestrator: Type.Optional(Type.Boolean({ description: "Full tools (Inbox, sub-agents, worktrees, panes) and a pane that stays open; default false" })),
				keepOpen: Type.Optional(Type.Boolean({ description: "Keep the pane after it finishes; default false, always true for orchestrators" })),
			}),
			outputSchema: Type.Object({ name: Type.String(), pane: Type.String(), session: Type.Optional(Type.String()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				if (!AGENT_NAME.test(params.name)) throw new Error(`invalid agent name: ${params.name}`);
				if (params.pane && !params.orchestrator)
					throw new Error("pane needs orchestrator: a sub-agent's env is set when its pane opens; pass workspace instead");
				if ((params.briefFile === undefined) === (params.prompt === undefined)) throw new Error("pass exactly one of briefFile and prompt");
				const running = launches.get(params.name);
				if (running && !reports.has(params.name)) throw new Error(`${params.name} is still running`);
				const prompt = (params.prompt ?? (await readFile(params.briefFile!, "utf8"))) + FINAL_REPLY_CONTRACT;

				const pane =
					params.pane ??
					(
						await placePane({
							cwd: params.cwd,
							tab: params.tab,
							workspace: params.workspace,
							otherWorktreeTab: "agent",
							envVars: params.orchestrator ? [] : SUB_AGENT_ENV,
						})
					).pane;
				const headAtLaunch = await commandOutput("git", ["rev-parse", "HEAD"], params.cwd);
				await herdr(
					["agent", "start", params.name, "--kind", "pi", "--pane", pane, "--",
						...(params.model ? ["--model", params.model] : []),
						...(params.thinking ? ["--thinking", params.thinking] : []),
						"--name", params.name],
					90_000,
				);
				const launch: Launch = {
					name: params.name,
					pane,
					cwd: params.cwd,
					model: params.model,
					thinking: params.thinking,
					session: (await agentInfo(params.name))?.agent_session?.value,
					keepOpen: params.orchestrator ? true : params.keepOpen ?? false,
					orchestrator: params.orchestrator ?? false,
					group: params.tab,
					headAtLaunch,
					launchedAt: Date.now(),
				};
				launches.set(launch.name, launch);
				reports.delete(launch.name);
				pi.appendEntry(LAUNCH_ENTRY, launch);
				// `prompt --wait` fails when no activity shows within 5 s; the prompt may still have landed.
				if (launch.orchestrator) orchestratorsWorking.add(launch.name);
				watch(launch, ["agent", "prompt", launch.name, prompt, "--wait"], { onFailure: () => void reattach(launch, false) });

				const result = { name: launch.name, pane, session: launch.session };
				return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, details: result };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "subagent_status",
			label: "Sub-agent status",
			description:
				"List the sub-agents launched from this session: running, done, error or stopped, with stats. Pass name for one agent's full final reply. For a check-in only; completion is delivered as a message.",
			parameters: Type.Object({ name: Type.Optional(Type.String()) }),
			outputSchema: Type.Object({ agents: Type.Array(Type.Any()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const selected = [...launches.values()].filter((l) => !params.name || l.name === params.name);
				if (params.name && selected.length === 0) throw new Error(`no sub-agent named ${params.name}`);
				const agents = await Promise.all(
					selected.map(async (launch) => {
						const report = launch.orchestrator ? undefined : reports.get(launch.name);
						const agent = report ? undefined : await agentInfo(launch.name);
						const status = report?.outcome ?? (agent ? `running (${agent.agent_status})` : "gone");
						const stats = launch.session ? await summarize(launch.session).catch(() => undefined) : undefined;
						return {
							name: launch.name,
							status,
							pane: launch.pane,
							session: launch.session,
							stats: stats && formatStats(stats.stats),
							reply: params.name ? truncate(stats?.reply ?? "") : undefined,
						};
					}),
				);
				return { content: [{ type: "text", text: JSON.stringify(agents, null, 1) }], structuredContent: { agents }, details: { agents } };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "subagent_stop",
			label: "Stop sub-agent",
			description: "Close a sub-agent's pane, running or not. No completion message follows.",
			parameters: Type.Object({ name: Type.String() }),
			outputSchema: Type.Object({ name: Type.String(), closed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const launch = launches.get(params.name);
				if (!launch) throw new Error(`no sub-agent named ${params.name}`);
				const watcher = watchers.get(launch.name);
				watchers.delete(launch.name);
				watcher?.kill();
				if (!reports.has(launch.name)) {
					reports.set(launch.name, { name: launch.name, outcome: "stopped", reply: "", session: launch.session });
					pi.appendEntry(REPORTED_ENTRY, { name: launch.name, outcome: "stopped" });
				}
				const closed = await herdr(["pane", "close", launch.pane]).then(() => true, () => false);
				const result = { name: launch.name, closed };
				return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, details: result };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "worktree_create",
			label: "Create worktree",
			description:
				"Create a git worktree for a branch as its own herdr workspace, like the user's new-worktree key. In a ship project the ship plugin then provisions it (database, .env, install, route) and lays it out as tabs agent, dev (setup, then ship up) and terminal; provisioning runs in the background after this returns. Pass startPi false to keep rootPane a free shell for subagent_launch({ pane: rootPane, orchestrator: true }).",
			parameters: Type.Object({
				cwd: Type.String({ description: "Any directory in the repository" }),
				branch: Type.String({ description: "Branch to check out; created when missing" }),
				base: Type.Optional(Type.String({ description: "Base ref for a new branch" })),
				label: Type.Optional(Type.String({ description: "Workspace label; default the branch" })),
				startPi: Type.Optional(Type.Boolean({ description: "Let the plugin start pi in the agent tab; default true" })),
				trustRepository: Type.Optional(Type.Boolean({ description: "herdr --trust-repository; only when the user verified the repository" })),
			}),
			outputSchema: Type.Object({
				workspace: Type.String(),
				path: Type.String(),
				branch: Type.String(),
				rootPane: Type.String(),
			}),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				const claim = params.startPi === false ? await claimRootPane(params.cwd, params.branch) : undefined;
				const args = ["worktree", "create", "--cwd", params.cwd, "--branch", params.branch, "--no-focus"];
				if (params.base) args.push("--base", params.base);
				if (params.label) args.push("--label", params.label);
				if (params.trustRepository) args.push("--trust-repository");
				const created = await herdr(args, 120_000).catch(async (error) => {
					if (claim) await rm(claim, { force: true });
					throw error;
				});
				return reply({
					workspace: created.result.workspace.workspace_id as string,
					path: created.result.worktree.path as string,
					branch: created.result.worktree.branch as string,
					rootPane: created.result.root_pane.pane_id as string,
				});
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "worktree_remove",
			label: "Remove worktree",
			description:
				"Remove a worktree workspace: closes its panes and deletes the checkout folder; uncommitted work in it is lost. In a ship project the ship plugin then tears the rest down (route, database, registry); the branch stays when it holds unpushed commits. Only when the user asked for it.",
			parameters: Type.Object({
				workspace: Type.String({ description: "The worktree's workspace id" }),
				force: Type.Optional(Type.Boolean({ description: "Remove even with uncommitted changes" })),
			}),
			outputSchema: Type.Object({ workspace: Type.String(), removed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				if (params.workspace === currentWorkspace()) throw new Error("refusing to remove the workspace this agent runs in");
				const args = ["worktree", "remove", "--workspace", params.workspace];
				if (params.force) args.push("--force");
				await herdr(args, 120_000);
				return reply({ workspace: params.workspace, removed: true });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_list",
			label: "List panes",
			description: "Panes of a workspace with their tab label, cwd, and the agent and its status when one runs there.",
			parameters: Type.Object({ workspace: Type.Optional(Type.String({ description: "Default this workspace" })) }),
			outputSchema: Type.Object({ panes: Type.Array(Type.Any()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const workspace = params.workspace ?? currentWorkspace();
				const [tabs, panes] = await Promise.all([
					herdr(["tab", "list", "--workspace", workspace]).then((r) => r.result.tabs as any[]),
					herdr(["pane", "list", "--workspace", workspace]).then((r) => r.result.panes as any[]),
				]);
				const labels = new Map(tabs.map((t) => [t.tab_id, t.label]));
				return reply({
					panes: panes.map((p) => ({
						pane: p.pane_id,
						tab: labels.get(p.tab_id),
						cwd: p.foreground_cwd ?? p.cwd,
						agent: p.agent,
						agentName: p.name,
						status: p.agent_status,
						self: p.pane_id === process.env.HERDR_PANE_ID || undefined,
					})),
				});
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_open",
			label: "Open pane",
			description:
				"Open a shell pane, focus kept, in the workspace whose checkout holds cwd: next to you when that is your workspace, else split into that worktree's terminal tab; tab puts it in a tab of that name. Runs command in it when given (watchers, tests). A dev server command (ship up, pnpm dev, vite) opens nothing: it returns the workspace's dev server as dev_server does.",
			parameters: Type.Object({
				cwd: Type.String({ description: "Absolute working directory" }),
				tab: Type.Optional(Type.String({ description: "Tab label; default none, next to you" })),
				workspace: Type.Optional(Type.String({ description: "Override the workspace; default the one whose checkout holds cwd" })),
				command: Type.Optional(Type.String()),
			}),
			outputSchema: Type.Object({ pane: Type.Optional(Type.String()), url: Type.Optional(Type.String()), devServer: Type.Optional(Type.Boolean()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				if (params.command && DEV_SERVER_COMMAND.test(params.command)) {
					const server = await ensureDevServer({ cwd: params.cwd, workspace: params.workspace });
					return reply({ pane: server.pane, url: server.url, devServer: true });
				}
				const { pane } = await placePane({ cwd: params.cwd, tab: params.tab, workspace: params.workspace, otherWorktreeTab: "terminal" });
				if (params.command) await herdr(["pane", "run", pane, params.command]);
				return reply({ pane });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "dev_server",
			label: "Dev server",
			description:
				"The dev server of the checkout that holds cwd: its ship URL and the pane in its workspace's dev tab. Starts ship up there only when the URL does not answer, then waits up to 3 min for it. Use it instead of starting a server yourself.",
			parameters: Type.Object({
				cwd: Type.String({ description: "Absolute directory inside the checkout" }),
				workspace: Type.Optional(Type.String({ description: "Override the workspace; default the one whose checkout holds cwd" })),
			}),
			outputSchema: Type.Object({ url: Type.Optional(Type.String()), pane: Type.Optional(Type.String()), started: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				return reply(await ensureDevServer({ cwd: params.cwd, workspace: params.workspace }));
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_run",
			label: "Run in pane",
			description: "Type a command into a pane's shell and press Enter. Returns at once; follow with pane_wait or pane_read.",
			parameters: Type.Object({ pane: Type.String(), command: Type.String() }),
			outputSchema: Type.Object({ pane: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				if (params.pane === process.env.HERDR_PANE_ID) throw new Error("that is this agent's own pane");
				await herdr(["pane", "run", params.pane, params.command]);
				return reply({ pane: params.pane });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_read",
			label: "Read pane",
			description: "Recent output of a pane, soft wraps joined.",
			parameters: Type.Object({ pane: Type.String(), lines: Type.Optional(Type.Number({ description: "Default 80" })) }),
			outputSchema: Type.Object({ pane: Type.String(), text: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				const text = await herdrText([
					"pane", "read", params.pane, "--source", "recent-unwrapped", "--lines", String(params.lines ?? 80),
				]);
				return reply({ pane: params.pane, text });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_wait",
			label: "Wait for pane output",
			description:
				"Wait until a pane's recent output has a line matching text or regex (Rust syntax, one line at a time). Output already on screen matches at once, and so does the command line pane_run typed: match what the command prints, not its own text. Fails on timeout.",
			parameters: Type.Object({
				pane: Type.String(),
				match: Type.Optional(Type.String({ description: "Literal substring" })),
				regex: Type.Optional(Type.String()),
				timeoutMs: Type.Number({ description: "At most 600000" }),
			}),
			outputSchema: Type.Object({ pane: Type.String(), line: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				if ((params.match === undefined) === (params.regex === undefined)) throw new Error("pass exactly one of match and regex");
				const timeout = Math.min(params.timeoutMs, 600_000);
				const pattern = params.match !== undefined ? ["--match", params.match] : ["--regex", params.regex!];
				const found = await herdr(
					["pane", "wait-output", params.pane, ...pattern, "--source", "recent-unwrapped", "--timeout", String(timeout)],
					timeout + 10_000,
				);
				return reply({ pane: params.pane, line: found.result.matched_line as string });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_close",
			label: "Close pane",
			description: "Close a pane and kill what runs in it. Only panes you opened, or when the user asked.",
			parameters: Type.Object({ pane: Type.String() }),
			outputSchema: Type.Object({ pane: Type.String(), closed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				currentWorkspace();
				if (params.pane === process.env.HERDR_PANE_ID) throw new Error("that is this agent's own pane");
				await herdr(["pane", "close", params.pane]);
				return reply({ pane: params.pane, closed: true });
			},
		}),
	);
}
