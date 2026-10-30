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
	launchedAt: number;
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

async function openPane(workspace: string, cwd: string, tabLabel: string, envVars: string[] = []): Promise<string> {
	const env = envVars.flatMap((kv) => ["--env", kv]);
	const tabs = (await herdr(["tab", "list", "--workspace", workspace])).result.tabs as any[];
	const tab = tabs.find((t) => t.label === tabLabel);
	if (!tab) {
		const created = await herdr([
			"tab", "create", "--workspace", workspace, "--label", tabLabel, "--cwd", cwd, ...env, "--no-focus",
		]);
		return created.result.root_pane.pane_id;
	}
	const panes = (await herdr(["pane", "list", "--workspace", workspace])).result.panes as any[];
	const inTab = panes.find((p) => p.tab_id === tab.tab_id);
	if (!inTab) throw new Error(`tab ${tabLabel} has no panes`);
	const target = await splitTarget(inTab.pane_id);
	const split = await herdr([
		"pane", "split", target.pane, "--direction", target.direction, "--cwd", cwd, ...env, "--no-focus",
	]);
	return split.result.pane.pane_id;
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

	const watch = (launch: Launch, args: string[], onFailure?: () => void) => {
		const child = spawn("herdr", args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (chunk) => (stderr += chunk));
		watchers.set(launch.name, child);
		child.on("exit", (code, signal) => {
			if (watchers.get(launch.name) !== child) return;
			watchers.delete(launch.name);
			if (signal) return;
			if (code === 0) void finish(launch);
			else if (onFailure) onFailure();
			else void finish(launch, stderr.trim() || `herdr exited with ${code}`);
		});
	};

	const settleWatch = (launch: Launch) => watch(launch, ["agent", "wait", launch.name]);

	const finish = async (launch: Launch, failure?: string) => {
		if (reports.has(launch.name)) return;
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
		reports.set(launch.name, report);
		pi.appendEntry(REPORTED_ENTRY, { name: launch.name, outcome: report.outcome });
		if (!launch.keepOpen && report.outcome === "done") await herdr(["pane", "close", launch.pane]).catch(() => {});

		const verb = report.outcome !== "done" ? "failed" : launch.orchestrator ? "settled (still running)" : "finished";
		const head = `${launch.orchestrator ? "Orchestrator" : "Sub-agent"} ${launch.name} ${verb}${report.stats ? `: ${formatStats(report.stats)}` : ""}`;
		const where = `Session: ${session ?? "unknown"}${!launch.keepOpen && report.outcome === "done" ? " (pane closed)" : ` (pane ${launch.pane} open)`}`;
		const body = [head, where, report.error ? `Error: ${report.error}` : undefined, "", truncate(report.reply || "(no reply)")]
			.filter((line) => line !== undefined)
			.join("\n");
		pi.sendMessage(
			{ customType: "subagent-done", content: body, display: true, details: report },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	};

	const reattach = async (launch: Launch) => {
		const agent = await agentInfo(launch.name);
		if (!agent || agent.pane_id !== launch.pane) return void finish(launch, agent ? undefined : "agent no longer running");
		if (agent.agent_status === "working") settleWatch(launch);
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
			else void reattach(launch);
		}
	});

	pi.on("session_shutdown", async () => {
		for (const child of watchers.values()) child.kill();
		watchers.clear();
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
				"Start a pi agent and send it a brief. By default it opens a new pane in this workspace (sub-agent tab, split from the largest pane, focus kept); pass workspace for another workspace, or pane for an existing shell pane such as worktree_create's rootPane. Returns at once. When the agent settles, its final reply, cost, shot runs and image reads arrive as a message that starts a turn, and its pane closes unless keepOpen. A sub-agent has the Plannotator Inbox and these tools off; an orchestrator keeps both, its pane stays open, and you hear once, when it first settles.",
			parameters: Type.Object({
				name: Type.String({ description: "Unique herdr agent name, [a-z][a-z0-9_-]{0,31}; also pi's session name" }),
				cwd: Type.String({ description: "Absolute working directory" }),
				model: Type.Optional(Type.String({ description: "pi --model, e.g. anthropic/claude-sonnet-5-5; default the user's" })),
				thinking: Type.Optional(Type.String({ description: "pi --thinking: off|minimal|low|medium|high|xhigh|max; default the user's" })),
				briefFile: Type.Optional(Type.String({ description: "Path of the brief to send; or pass prompt" })),
				prompt: Type.Optional(Type.String({ description: "Brief text; or pass briefFile" })),
				tab: Type.Optional(Type.String({ description: "Tab label for a new pane; default spec-flow" })),
				workspace: Type.Optional(Type.String({ description: "Workspace for a new pane; default this one" })),
				pane: Type.Optional(Type.String({ description: "Existing shell pane at its prompt to start in, e.g. a worktree's rootPane; orchestrators only" })),
				orchestrator: Type.Optional(Type.Boolean({ description: "Full tools (Inbox, sub-agents, worktrees, panes) and a pane that stays open; default false" })),
				keepOpen: Type.Optional(Type.Boolean({ description: "Keep the pane after it finishes; default false, always true for orchestrators" })),
			}),
			outputSchema: Type.Object({ name: Type.String(), pane: Type.String(), session: Type.Optional(Type.String()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const here = currentWorkspace();
				const workspace = params.workspace ?? here;
				if (!AGENT_NAME.test(params.name)) throw new Error(`invalid agent name: ${params.name}`);
				if (params.pane && !params.orchestrator)
					throw new Error("pane needs orchestrator: a sub-agent's env is set when its pane opens; pass workspace instead");
				if ((params.briefFile === undefined) === (params.prompt === undefined)) throw new Error("pass exactly one of briefFile and prompt");
				const running = launches.get(params.name);
				if (running && !reports.has(params.name)) throw new Error(`${params.name} is still running`);
				const prompt = params.prompt ?? (await readFile(params.briefFile!, "utf8"));

				const pane =
					params.pane ??
					(await openPane(workspace, params.cwd, params.tab ?? "spec-flow", params.orchestrator ? [] : SUB_AGENT_ENV));
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
					launchedAt: Date.now(),
				};
				launches.set(launch.name, launch);
				reports.delete(launch.name);
				pi.appendEntry(LAUNCH_ENTRY, launch);
				// `prompt --wait` fails when no activity shows within 5 s; the prompt may still have landed.
				watch(launch, ["agent", "prompt", launch.name, prompt, "--wait"], () => void reattach(launch));

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
						const report = reports.get(launch.name);
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
				"Open a shell pane, focus kept: a new tab with that label, or a split of the largest pane when the tab exists. Runs command in it when given (servers, watchers, tests).",
			parameters: Type.Object({
				cwd: Type.String({ description: "Absolute working directory" }),
				tab: Type.String({ description: "Tab label" }),
				workspace: Type.Optional(Type.String({ description: "Default this workspace" })),
				command: Type.Optional(Type.String()),
			}),
			outputSchema: Type.Object({ pane: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const pane = await openPane(params.workspace ?? currentWorkspace(), params.cwd, params.tab);
				if (params.command) await herdr(["pane", "run", pane, params.command]);
				return reply({ pane });
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
