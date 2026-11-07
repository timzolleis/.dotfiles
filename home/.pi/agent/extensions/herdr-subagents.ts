import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const LAUNCH_ENTRY = "subagent-launch";
const REPORTED_ENTRY = "subagent-reported";
const REPLY_LIMIT = 6000;
const REPORT_REPLY_LINES = 15;
const REPORT_REPLY_CHARS = 2500;
const BATCH_WINDOW_MS = 60_000;
const DEV_SERVER_COMMAND = /\bship\s+up\b|\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?dev\b|\bvite(?:\s+dev)?\b/;
const DEV_SERVER_START_TIMEOUT_MS = 180_000;
const TAB_ADOPTION_TIMEOUT_MS = 5_000;
const FINAL_REPLY_CONTRACT =
	"\n\nFinal reply: at most 10 lines: what changed, what is left, and any decision for whoever launched you. They see your commits, diff and PR without you listing them.";
const SUB_AGENT_ENV = ["PLANNOTATOR_INBOX_TOOL=0", "PLANNOTATOR_AGENT_TOOL=0", "PI_SUBAGENT=1"];
const SUB_AGENT_EXCLUDED_TOOLS = "inbox_send,inbox_read";
const SHOT_PATTERN = /\bpnpm\s+(?:-s\s+)?shot\b|\bshot\s+(?:publish|outline|flow)\b/;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const WORKTREE_ROOT = join(homedir(), ".herdr/worktrees");
const TURN_END_STATES = new Set(["done", "idle", "error", "blocked"]);
const LOCKFILES: Array<{ file: string; packageManager: PackageManager }> = [
	{ file: "pnpm-lock.yaml", packageManager: "pnpm" },
	{ file: "bun.lock", packageManager: "bun" },
	{ file: "bun.lockb", packageManager: "bun" },
	{ file: "yarn.lock", packageManager: "yarn" },
	{ file: "package-lock.json", packageManager: "npm" },
];
const INSTALL_COMMANDS: Record<PackageManager, string> = {
	pnpm: "pnpm install --offline --frozen-lockfile || pnpm install",
	npm: "npm ci --offline || npm install",
	yarn: "yarn install --offline --frozen-lockfile || yarn install",
	bun: "bun install --frozen-lockfile || bun install",
};
const TASK_LIMIT = 60;
const SETUP_WAIT_SECONDS = 1800;
const SHELL_NAMES = new Set(["zsh", "bash", "fish", "sh", "-zsh", "-bash", "-fish"]);

type AgentRole = "impl" | "review" | "orchestrator";
type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface Launch {
	name: string;
	terminal: string;
	cwd: string;
	model?: string;
	thinking?: string;
	sessionId: string;
	session?: string;
	keepOpen: boolean;
	orchestrator?: boolean;
	group?: string;
	headAtLaunch?: string;
	turnAtLaunch: number;
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
	turn?: number;
	terminalClosed?: boolean;
}

interface AppTerminal {
	terminal: string;
	pane: string;
	status: string | null;
	app: string | null;
	name: string | null;
}

interface AppTab {
	id: string;
	name: string;
	terminals: AppTerminal[];
}

interface AppSpace {
	id: string;
	name: string;
	folder: string | null;
	machine: string | null;
	tabs: AppTab[];
}

interface HcTerminal {
	address: string;
	name: string | null;
	state: "live" | "finished";
	turn: number;
	status: { app?: string; state: string } | null;
	labels: Record<string, string>;
	foreground?: { name?: string; cwd?: string };
	cwd: string;
	exit_code: number | null;
	reason: string | null;
}

interface Placement {
	space: string;
	tab: string;
	newTabName?: string;
}

function commandFailure(command: string, args: string[], stderr: string, error: Error): Error {
	const text = stderr.trim();
	try {
		const parsed = JSON.parse(text);
		if (parsed?.error?.message)
			return new Error(`${command} ${args[0]}: ${parsed.error.message}${parsed.error.hint ? ` (${parsed.error.hint})` : ""}`);
	} catch {}
	return new Error(`${command} ${args[0]}: ${text || error.message}`);
}

function hcText(args: string[], timeoutMs = 60_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("hc", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) reject(commandFailure("hc", args, stderr, error));
			else resolve(stdout);
		});
	});
}

async function hc<T = any>(args: string[], timeoutMs = 60_000): Promise<T> {
	const [command, ...rest] = args;
	const stdout = await hcText([command, "--json", ...rest], timeoutMs);
	return (stdout.trim() ? JSON.parse(stdout) : {}) as T;
}

function herdrApp<T = any>(args: string[]): Promise<T> {
	return new Promise((resolve, reject) => {
		execFile("herdr-app", args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			let parsed: any;
			try {
				parsed = stdout.trim() ? JSON.parse(stdout) : {};
			} catch {
				parsed = undefined;
			}
			if (parsed?.error) reject(new Error(`herdr-app ${args.slice(0, 2).join(" ")}: ${parsed.error}`));
			else if (error || parsed === undefined) reject(commandFailure("herdr-app", args, stderr || stdout, error ?? new Error("unreadable output")));
			else resolve(parsed as T);
		});
	});
}

function runAppCommand<T = any>(command: string, args: Record<string, unknown>): Promise<T> {
	return herdrApp<T>(["do", command, JSON.stringify(args)]);
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", ["-C", cwd, ...args], (error, stdout, stderr) => {
			if (error) reject(new Error(`git ${args[0]}: ${(stderr || error.message).trim()}`));
			else resolve(stdout.trim());
		});
	});
}

function commandOutput(command: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim()),
		);
	});
}

function reply<T extends object>(result: T) {
	return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 1) }], structuredContent: result, details: result };
}

function ownTerminal(): string {
	const terminal = process.env.HC_TERMINAL_ID;
	if (!terminal) throw new Error("not running in a herdr-core terminal (HC_TERMINAL_ID is unset)");
	return terminal;
}

function shellQuote(text: string): string {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function appSpaces(): Promise<AppSpace[]> {
	return (await herdrApp<{ spaces: AppSpace[] }>(["ls"])).spaces;
}

async function hcTerminal(terminal: string): Promise<HcTerminal | undefined> {
	return hc<HcTerminal>(["get", terminal]).catch(() => undefined);
}

function isInside(directory: string, root: string): boolean {
	return directory === root || directory.startsWith(root.endsWith("/") ? root : `${root}/`);
}

async function checkoutRoot(directory: string): Promise<string | undefined> {
	const top = await commandOutput("git", ["rev-parse", "--show-toplevel"], directory);
	return top ? realpath(top).catch(() => top) : undefined;
}

export async function spaceContainingCwd(cwd: string, spaces: AppSpace[]): Promise<string | undefined> {
	const directory = await realpath(cwd).catch(() => cwd);
	const checkouts = await Promise.all(
		spaces
			.filter((space) => space.folder && !space.machine)
			.map(async (space) => {
				const folder = await realpath(space.folder!).catch(() => space.folder!);
				return { space: space.id, folder, isCheckout: (await checkoutRoot(folder)) === folder };
			}),
	);
	return checkouts
		.filter(({ folder, isCheckout }) => isCheckout && isInside(directory, folder))
		.sort((left, right) => right.folder.length - left.folder.length)[0]?.space;
}

async function callerPlacement(): Promise<{ space?: string; tab?: string }> {
	const self = await hcTerminal(ownTerminal());
	return { space: self?.labels["herdr.space"], tab: self?.labels["herdr.tab"] };
}

const newTabIds = new Map<string, string>();

function tabIdForName({ spaces, space, name }: { spaces: AppSpace[]; space: string; name: string }): string {
	const existing = spaces.find((s) => s.id === space)?.tabs.find((t) => t.name === name);
	if (existing) return existing.id;
	const key = `${space}\n${name}`;
	let id = newTabIds.get(key);
	if (!id) {
		id = `tb${randomBytes(16).toString("hex")}`;
		newTabIds.set(key, id);
	}
	return id;
}

async function placement({
	cwd,
	tab,
	workspace,
	otherSpaceTab,
}: {
	cwd: string;
	tab?: string;
	workspace?: string;
	otherSpaceTab: string;
}): Promise<Placement | undefined> {
	const [caller, spaces] = await Promise.all([callerPlacement(), appSpaces()]);
	const space = workspace ?? (await spaceContainingCwd(cwd, spaces)) ?? caller.space;
	if (!space) return undefined;
	if (!spaces.some((s) => s.id === space)) throw new Error(`no space ${space}`);
	if (tab) return { space, tab: tabIdForName({ spaces, space, name: tab }), newTabName: tab };
	if (space === caller.space && caller.tab) return { space, tab: caller.tab };
	return { space, tab: tabIdForName({ spaces, space, name: otherSpaceTab }), newTabName: otherSpaceTab };
}

async function nameTab(where: Placement) {
	if (!where.newTabName) return;
	const deadline = Date.now() + TAB_ADOPTION_TIMEOUT_MS;
	for (;;) {
		try {
			await runAppCommand("tab.rename", { id: where.tab, name: where.newTabName });
			return;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await delay(150);
		}
	}
}

async function runTerminal({
	cwd,
	where,
	name,
	argv,
	parent,
}: {
	cwd: string;
	where?: Placement;
	name?: string;
	argv?: string[];
	parent: "self" | "self-outlived" | "none";
}): Promise<string> {
	const args = ["run", "--bg", "--no-notify", "--cwd", cwd];
	if (where) args.push("--label", `herdr.space=${where.space}`, "--label", `herdr.tab=${where.tab}`);
	if (name) args.push("--name", name);
	if (parent === "none") args.push("--no-parent");
	if (parent === "self-outlived") args.push("--outlive-parent");
	if (argv) args.push("--", ...argv);
	const started = await hc<{ address: string }>(args);
	if (where) await nameTab(where);
	return started.address;
}

async function closeTerminal(terminal: string): Promise<boolean> {
	const info = await hcTerminal(terminal);
	if (!info) return false;
	if (info.state === "live") await hc(["kill", terminal]).catch(() => {});
	await hc(["rm", terminal]).catch(() => {});
	return true;
}

async function settleTabOfTerminal(terminal: string) {
	const tab = (await appSpaces()).flatMap((space) => space.tabs).find((t) => t.terminals.some((x) => x.terminal === terminal));
	if (!tab || tab.terminals.some((x) => x.terminal !== terminal && x.status === "working")) return;
	await runAppCommand("tab.settle", { id: tab.id });
}

async function isAtShellPrompt(terminal: string): Promise<boolean> {
	const info = await hcTerminal(terminal);
	return info?.state === "live" && SHELL_NAMES.has(info.foreground?.name ?? "");
}

async function sessionFileForId(sessionsRoot: string, sessionId: string): Promise<string | undefined> {
	const suffix = `_${sessionId}.jsonl`;
	for (const directory of await readdir(sessionsRoot).catch(() => [] as string[])) {
		const file = (await readdir(join(sessionsRoot, directory)).catch(() => [] as string[])).find((f) => f.endsWith(suffix));
		if (file) return join(sessionsRoot, directory, file);
	}
	return undefined;
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

async function ensureDevServer({ cwd, workspace }: { cwd: string; workspace?: string }): Promise<{ url?: string; pane?: string; started: boolean }> {
	const checkout = await gitCheckout(cwd);
	if (!checkout) throw new Error(`${cwd} is not in a git repository`);
	const path = await realpath(checkout.top).catch(() => checkout.top);
	const existing = await findDevTerminal(path);
	let url = await devServerUrl(cwd);
	if (url && (await isServing(url))) return { url, pane: existing, started: false };
	const space = workspace ?? (await spaceContainingCwd(cwd, await appSpaces())) ?? (await callerPlacement()).space;
	const branch = await git(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const terminal = existing ?? (await startDevTerminal({ main: checkout.main, path, branch, space }));
	if (!(await shipAliasForRepo(checkout.main))) return { pane: terminal, started: !existing };
	const deadline = Date.now() + DEV_SERVER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		url ??= await devServerUrl(cwd);
		if (url && (await isServing(url))) {
			await hc(["label", terminal, `herdr.url=${url}`]).catch(() => {});
			return { url, pane: terminal, started: !existing };
		}
		await delay(3000);
	}
	throw new Error(`the dev server did not answer within ${DEV_SERVER_START_TIMEOUT_MS / 1000}s; read terminal ${terminal}`);
}

export function lastLines(text: string, count: number): string {
	const lines = text.replace(/\s+$/, "").split("\n");
	return lines.slice(-count).join("\n");
}

function startOutputWait({ terminal, text, timeoutMs }: { terminal: string; text: string; timeoutMs: number }) {
	const child = spawn("hc", ["wait", terminal, "--output", text, "--timeout", String(Math.max(1, Math.ceil(timeoutMs / 1000))), "--json"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	let cancelled = false;
	const result = new Promise<{ reason: string }>((resolve, reject) =>
		child.on("exit", () => {
			if (cancelled) return resolve({ reason: "cancelled" });
			try {
				resolve(JSON.parse(stdout));
			} catch {
				reject(new Error(`hc wait: ${stderr.trim() || "no result"}`));
			}
		}),
	);
	return {
		result,
		cancel: () => {
			cancelled = true;
			child.kill();
		},
	};
}

async function waitForLine({
	terminal,
	matches,
	waitText,
	timeoutMs,
}: {
	terminal: string;
	matches: (line: string) => boolean;
	waitText: string;
	timeoutMs: number;
}): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(`no matching line in ${terminal} within ${timeoutMs} ms`);
		const waiting = startOutputWait({ terminal, text: waitText, timeoutMs: remaining });
		const screen = await hcText(["read", terminal, "--lines", "200"]).catch((error) => {
			waiting.cancel();
			throw error;
		});
		const found = screen.split("\n").reverse().find(matches);
		if (found !== undefined) {
			waiting.cancel();
			return found;
		}
		const { reason } = await waiting.result;
		if (reason === "timeout") throw new Error(`no matching line in ${terminal} within ${timeoutMs} ms`);
		if (reason === "exit" || reason === "finished" || reason === "error" || reason === "blocked") {
			const last = (await hcText(["read", terminal, "--lines", "200"]).catch(() => "")).split("\n").reverse().find(matches);
			if (last !== undefined) return last;
			throw new Error(`${terminal} stopped (${reason}) before a matching line`);
		}
	}
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

function piArguments({
	name,
	sessionId,
	model,
	thinking,
	subAgent,
}: Pick<Launch, "name" | "sessionId" | "model" | "thinking"> & { subAgent: boolean }): string[] {
	return [
		"--session-id", sessionId,
		"--name", name,
		...(model ? ["--model", model] : []),
		...(thinking ? ["--thinking", thinking] : []),
		...(subAgent ? ["--exclude-tools", SUB_AGENT_EXCLUDED_TOOLS] : []),
	];
}

async function gitCheckout(folder: string): Promise<{ top: string; main: string } | undefined> {
	const top = await commandOutput("git", ["rev-parse", "--show-toplevel"], folder);
	const common = await commandOutput("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], folder);
	if (!top || !common) return undefined;
	return { top, main: common.endsWith("/.git") ? common.slice(0, -5) : common };
}

async function shipAliasForRepo(repoRoot: string): Promise<string | undefined> {
	const listed = await commandOutput("ship", ["projects", "--json"], repoRoot);
	if (!listed) return undefined;
	const root = await realpath(repoRoot).catch(() => repoRoot);
	const projects = JSON.parse(listed) as Array<{ alias: string; path: string }>;
	for (const project of projects) if ((await realpath(project.path).catch(() => project.path)) === root) return project.alias;
	return undefined;
}

async function shipWorkspaceAtPath(path: string): Promise<{ project: string; branch: string } | undefined> {
	const listed = await commandOutput("ship", ["ls", "--json", "--no-pr"], "/");
	if (!listed) return undefined;
	const entries = JSON.parse(listed) as Array<{ project: string; branch: string; path?: string }>;
	return entries.find((e) => e.path?.replace(/\/$/, "") === path.replace(/\/$/, ""));
}

export function worktreeFolderName(branch: string): string {
	return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sliceBranchName({ parent, slice }: { parent: string; slice: string }): string {
	return `${parent}--${slice}`;
}

export function taskFromBranch(branch: string): string {
	const lastSegment = branch.split("/").pop() ?? branch;
	return lastSegment
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

export function taskFromBrief(brief: string): string {
	const firstLine = brief.split("\n").map((line) => line.replace(/^[#>\s*-]+/, "").trim()).find(Boolean) ?? "";
	return firstLine.length <= TASK_LIMIT ? firstLine : `${firstLine.slice(0, TASK_LIMIT - 1).trimEnd()}…`;
}

export function agentTabName({ name, tab }: { name: string; tab?: string }): string {
	return tab ?? name;
}

export function packageManagerFromFiles(files: string[]): PackageManager | undefined {
	return LOCKFILES.find(({ file }) => files.includes(file))?.packageManager;
}

export function setupScript({ ship, bare, packageManager }: { ship: boolean; bare: boolean; packageManager?: PackageManager }): string | undefined {
	const steps = [
		ship ? `ship create "$1" "$2" ${bare ? "--bare " : ""}--no-editor` : undefined,
		packageManager && !ship ? `{ ${INSTALL_COMMANDS[packageManager]}; }` : undefined,
	].filter((step): step is string => !!step);
	return steps.length ? steps.join(" && ") : undefined;
}

export function devScript({ ship, packageManager, waitsForSetup }: { ship: boolean; packageManager?: PackageManager; waitsForSetup: boolean }): string {
	const wait = waitsForSetup
		? `i=0; while hc get "$3" --json 2>/dev/null | grep -q '"state":"live"' && [ $i -lt ${SETUP_WAIT_SECONDS / 2} ]; do sleep 2; i=$((i+1)); done; `
		: "";
	const start = ship ? 'ship create "$1" "$2" --no-editor && exec ship up' : `exec ${packageManager ?? "npm"} run dev`;
	return wait + start;
}

export interface WorktreeEntry {
	path: string;
	branch: string;
	parent?: string;
	space?: string;
	dirty: boolean;
	merged: boolean;
	ship?: string;
}

export type WorktreeNode = WorktreeEntry & { slices: WorktreeNode[] };

export function worktreeTree(entries: WorktreeEntry[]): WorktreeNode[] {
	const nodes = entries.map((entry): WorktreeNode => ({ ...entry, slices: [] }));
	const roots: WorktreeNode[] = [];
	for (const node of nodes) {
		const parent = node.parent ? nodes.find((other) => other.branch === node.parent) : undefined;
		(parent ? parent.slices : roots).push(node);
	}
	return roots;
}

async function checkoutFiles(path: string): Promise<string[]> {
	return readdir(path).catch(() => [] as string[]);
}

async function copyMissingEnvFiles({ main, path }: { main: string; path: string }) {
	for (const name of (await checkoutFiles(main)).filter((file) => file.startsWith(".env"))) {
		const present = await stat(join(path, name)).then(() => true, () => false);
		const isFile = await stat(join(main, name)).then((s) => s.isFile(), () => false);
		const ignored = (await commandOutput("git", ["check-ignore", "-q", name], main)) !== undefined;
		if (!present && isFile && ignored) await copyFile(join(main, name), join(path, name));
	}
}

async function shipSupportsBare(directory: string): Promise<boolean> {
	return ((await commandOutput("ship", ["create", "--help"], directory)) ?? "").includes("--bare");
}

async function startBackgroundTerminal({
	cwd,
	kind,
	space,
	script,
	args,
}: {
	cwd: string;
	kind: "setup" | "dev";
	space?: string;
	script: string;
	args: string[];
}): Promise<string> {
	const labels = [`herdr.bg=${kind}`, ...(space ? [`herdr.bg.space=${space}`] : [])].flatMap((label) => ["--label", label]);
	const started = await hc<{ address: string }>(["run", "--bg", "--no-parent", "--no-notify", "--cwd", cwd, ...labels, "--", "sh", "-c", script, "sh", ...args]);
	return started.address;
}

async function startCheckoutSetup({ main, path, branch, space }: { main: string; path: string; branch: string; space?: string }): Promise<string | undefined> {
	const alias = await shipAliasForRepo(main);
	if (!alias) await copyMissingEnvFiles({ main, path });
	const script = setupScript({
		ship: !!alias,
		bare: alias ? await shipSupportsBare(main) : false,
		packageManager: packageManagerFromFiles(await checkoutFiles(path)),
	});
	if (!script) return undefined;
	return startBackgroundTerminal({ cwd: path, kind: "setup", space, script, args: [alias ?? "", branch] });
}

async function startDevTerminal({ main, path, branch, space, setupTerminal }: { main: string; path: string; branch: string; space?: string; setupTerminal?: string }) {
	const alias = await shipAliasForRepo(main);
	const script = devScript({
		ship: !!alias,
		packageManager: packageManagerFromFiles(await checkoutFiles(path)),
		waitsForSetup: !!setupTerminal,
	});
	return startBackgroundTerminal({ cwd: path, kind: "dev", space, script, args: [alias ?? "", branch, setupTerminal ?? ""] });
}

async function findDevTerminal(checkoutPath: string): Promise<string | undefined> {
	const listed = await hc<{ terminals: Array<{ address: string; cwd: string }> }>(["ls", "--label", "herdr.bg=dev"]);
	for (const terminal of listed.terminals ?? [])
		if ((await realpath(terminal.cwd).catch(() => terminal.cwd)) === checkoutPath) return terminal.address;
	return undefined;
}

async function worktreeParent({ main, branch }: { main: string; branch: string }): Promise<string | undefined> {
	return (await commandOutput("git", ["config", "--get", `branch.${branch}.herdrParent`], main)) || undefined;
}

async function isBranchMerged({ main, branch, into }: { main: string; branch: string; into: string }): Promise<boolean> {
	return git(main, ["merge-base", "--is-ancestor", branch, into]).then(() => true, () => false);
}

async function defaultBranch(main: string): Promise<string> {
	const remote = await commandOutput("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], main);
	if (remote) return remote;
	return (await git(main, ["show-ref", "--verify", "--quiet", "refs/heads/main"]).then(() => true, () => false)) ? "main" : "master";
}

async function liveTerminalsInside(checkoutPath: string): Promise<string[]> {
	const listed = await hc<{ terminals: Array<{ address: string; cwd: string }> }>(["ls"]);
	const inside: string[] = [];
	for (const terminal of listed.terminals ?? [])
		if (isInside(await realpath(terminal.cwd).catch(() => terminal.cwd), checkoutPath)) inside.push(terminal.address);
	return inside;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT === "1") return;
	const launches = new Map<string, Launch>();
	const reports = new Map<string, Report>();
	const watchers = new Map<string, ChildProcess>();
	let sessionsRoot = join(homedir(), ".pi/agent/sessions");

	const orchestratorsWorking = new Set<string>();
	const pending: Array<{ launch: Launch; report: Report }> = [];
	let batchTimer: ReturnType<typeof setTimeout> | undefined;

	const stopWatching = (name: string) => {
		const watcher = watchers.get(name);
		watchers.delete(name);
		watcher?.kill();
	};

	const watchTurns = (launch: Launch, sinceTurn: number) => {
		stopWatching(launch.name);
		const child = spawn("hc", ["events", "--json", "--terminal", launch.terminal], { stdio: ["ignore", "pipe", "ignore"] });
		watchers.set(launch.name, child);
		const isCurrent = () => watchers.get(launch.name) === child;
		let reportedTurn = sinceTurn;
		let buffered = "";
		const settle = (turn: number) => {
			if (turn <= reportedTurn || !isCurrent()) return;
			reportedTurn = turn;
			if (!launch.orchestrator) stopWatching(launch.name);
			void finish(launch, { turn });
		};
		const exited = (why: string) => {
			if (!isCurrent()) return;
			stopWatching(launch.name);
			const wasWorking = launch.orchestrator ? orchestratorsWorking.has(launch.name) : !reports.has(launch.name);
			orchestratorsWorking.delete(launch.name);
			if (wasWorking) void finish(launch, { failure: `exited before its turn ended (${why})` });
		};
		const markWorking = () => {
			if (launch.orchestrator) orchestratorsWorking.add(launch.name);
		};
		const handle = (line: string) => {
			let message: any;
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (Array.isArray(message.terminals)) {
				const terminal = message.terminals[0] as HcTerminal | undefined;
				if (!terminal || terminal.state === "finished") return exited(terminal?.reason ?? "gone");
				if (terminal.status?.state === "working") return markWorking();
				if (TURN_END_STATES.has(terminal.status?.state ?? "")) settle(terminal.turn);
				return;
			}
			const event = message.params;
			if (event?.type === "status" && event.data?.status?.state === "working") markWorking();
			if (event?.type === "turn" && TURN_END_STATES.has(event.data?.state)) settle(event.data.turn);
			if (event?.type === "finished") exited(event.data?.reason ?? `exit ${event.data?.exit_code}`);
		};
		child.stdout!.on("data", (chunk) => {
			buffered += chunk;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) handle(line);
		});
		child.on("exit", () => {
			if (!isCurrent()) return;
			watchers.delete(launch.name);
			void delay(1000).then(() => reattach(launch, reportedTurn));
		});
	};

	const isRunning = (launch: Launch) =>
		launch.orchestrator ? orchestratorsWorking.has(launch.name) : !reports.has(launch.name);

	const reportBlock = ({ launch, report }: { launch: Launch; report: Report }) => {
		const verb = report.outcome !== "done" ? "failed" : launch.orchestrator ? "settled (still running)" : "finished";
		const head = `${launch.orchestrator ? "Orchestrator" : "Sub-agent"} ${launch.name} ${verb}${report.stats ? `: ${formatStats(report.stats)}` : ""}`;
		const where = `Session: ${report.session ?? "unknown"}${report.terminalClosed ? " (terminal closed)" : ` (terminal ${launch.terminal} open)`}`;
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
		for (const { report } of items) pi.appendEntry(REPORTED_ENTRY, { name: report.name, outcome: report.outcome, turn: report.turn });
		pi.sendMessage(
			{ customType: "subagent-done", content: body, display: true, details },
			{ triggerTurn: !items.every(({ launch, report }) => launch.orchestrator && report.outcome === "done"), deliverAs: "followUp" },
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

	const finish = async (launch: Launch, { failure, turn }: { failure?: string; turn?: number } = {}) => {
		if (!launch.orchestrator && reports.has(launch.name)) return;
		orchestratorsWorking.delete(launch.name);
		launch.session ??= await sessionFileForId(sessionsRoot, launch.sessionId);
		const session = launch.session;
		let report: Report = { name: launch.name, outcome: failure ? "error" : "done", reply: "", session, error: failure, turn };
		if (!session && !failure) report = { ...report, outcome: "error", error: "no session file" };
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
		const terminalEnded = (await hcTerminal(launch.terminal))?.state !== "live";
		report.terminalClosed = terminalEnded || (!launch.keepOpen && report.outcome === "done");
		if (report.terminalClosed) {
			stopWatching(launch.name);
			await closeTerminal(launch.terminal);
		} else if (!launch.orchestrator) await settleTabOfTerminal(launch.terminal).catch(() => {});
		queue(launch, report);
	};

	const reattach = async (launch: Launch, sinceTurn: number) => {
		const terminal = await hcTerminal(launch.terminal);
		if (!terminal || terminal.state === "finished") {
			const unreported = launch.orchestrator ? orchestratorsWorking.has(launch.name) : !reports.has(launch.name);
			orchestratorsWorking.delete(launch.name);
			if (unreported) void finish(launch, { failure: "agent no longer running" });
			return;
		}
		watchTurns(launch, sinceTurn);
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		launches.clear();
		reports.clear();
		sessionsRoot = dirname(ctx.sessionManager.getSessionDir());
		const reported = new Map<string, { outcome: Report["outcome"]; turn?: number }>();
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry.type !== "custom") continue;
			if (entry.customType === LAUNCH_ENTRY && entry.data.terminal) launches.set(entry.data.name, entry.data);
			if (entry.customType === REPORTED_ENTRY) reported.set(entry.data.name, { outcome: entry.data.outcome, turn: entry.data.turn });
		}
		if (!process.env.HC_TERMINAL_ID) return;
		for (const launch of launches.values()) {
			const last = reported.get(launch.name);
			if (last) reports.set(launch.name, { name: launch.name, outcome: last.outcome, reply: "", session: launch.session });
			if (!last) {
				if (launch.orchestrator) orchestratorsWorking.add(launch.name);
				void reattach(launch, launch.turnAtLaunch);
			} else if (launch.orchestrator && last.outcome === "done") void reattach(launch, last.turn ?? launch.turnAtLaunch);
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
			"Herdr: pi sub-agents and orchestrators, git worktrees (each its own Herdr space, provisioned by ship in a ship project), and terminals (herdr-core). Sub-agent completion arrives as a message; never wait or poll for it.",
	};

	pi.registerTool(
		defineTool({
			name: "subagent_launch",
			label: "Launch sub-agent",
			description:
				"Start a pi agent in its own herdr-core terminal with a brief. It gets a new tab named after it (name) in your space, also when cwd is a slice worktree; tab groups agents in one tab of that name (one per reviewer set, say). Never a split in your tab. Focus is kept. pane starts it in an existing shell terminal such as worktree_create's rootPane. Returns at once. When it settles you get one message with its commits, diff, uncommitted files, PR and checks, and its reply capped at 15 lines; agents sharing a tab report together when the last settles, others that settle within 60 s are batched. Its terminal stays open and its tab settles so the person can read it; keepOpen false closes it. It keeps you as parent. subagent_send steers it. A sub-agent has the Inboxes and these tools off and ends with you; an orchestrator keeps both, its terminal stays open and outlives you, and it reports each time it settles.",
			parameters: Type.Object({
				name: Type.String({ description: "Unique terminal name, [a-z][a-z0-9_-]{0,31}; also pi's session name" }),
				cwd: Type.String({ description: "Absolute working directory" }),
				model: Type.Optional(Type.String({ description: "pi --model, e.g. anthropic/claude-sonnet-5-5; default the user's" })),
				thinking: Type.Optional(Type.String({ description: "pi --thinking: off|minimal|low|medium|high|xhigh|max; default the user's" })),
				briefFile: Type.Optional(Type.String({ description: "Path of the brief to send; or pass prompt" })),
				prompt: Type.Optional(Type.String({ description: "Brief text; or pass briefFile" })),
				tab: Type.Optional(Type.String({ description: "Group: a tab of this name holds the agents; default a tab named after the agent" })),
				workspace: Type.Optional(Type.String({ description: "Override the space id; default your own space" })),
				role: Type.Optional(Type.Union([Type.Literal("impl"), Type.Literal("review")], { description: "Default impl; orchestrators are always orchestrator" })),
				task: Type.Optional(Type.String({ description: "What it works on, shown in the agents list; default the brief's first line, at most 60 chars" })),
				pane: Type.Optional(Type.String({ description: "Existing shell terminal at its prompt to start in, e.g. a worktree's rootPane; orchestrators only" })),
				orchestrator: Type.Optional(Type.Boolean({ description: "Full tools (Inboxes, sub-agents, worktrees, terminals) and a terminal that stays open; default false" })),
				keepOpen: Type.Optional(Type.Boolean({ description: "Keep the terminal open and settle its tab after it finishes; default true. false closes it" })),
			}),
			outputSchema: Type.Object({ name: Type.String(), pane: Type.String(), session: Type.Optional(Type.String()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				if (!AGENT_NAME.test(params.name)) throw new Error(`invalid agent name: ${params.name}`);
				if (params.pane && !params.orchestrator)
					throw new Error("pane needs orchestrator: a sub-agent's env is set when its terminal starts; pass workspace instead");
				if ((params.briefFile === undefined) === (params.prompt === undefined)) throw new Error("pass exactly one of briefFile and prompt");
				const running = launches.get(params.name);
				if (running && isRunning(running)) throw new Error(`${params.name} is still running`);
				const brief = params.prompt ?? (await readFile(params.briefFile!, "utf8"));
				const prompt = brief + FINAL_REPLY_CONTRACT;
				const orchestrator = params.orchestrator ?? false;
				const role: AgentRole = orchestrator ? "orchestrator" : params.role ?? "impl";
				const agentEnv = [`HERDR_ROLE=${role}`, `HERDR_TASK=${params.task ?? taskFromBrief(brief)}`];
				const headAtLaunch = await commandOutput("git", ["rev-parse", "HEAD"], params.cwd);
				const draft = {
					name: params.name,
					cwd: params.cwd,
					model: params.model,
					thinking: params.thinking,
					sessionId: randomUUID(),
					keepOpen: orchestrator ? true : params.keepOpen ?? true,
					orchestrator,
					group: params.tab,
					headAtLaunch,
					launchedAt: Date.now(),
				};

				let terminal: string;
				let turnAtLaunch = 0;
				if (params.pane) {
					const shell = await hcTerminal(params.pane);
					if (!shell || !(await isAtShellPrompt(params.pane))) throw new Error(`${params.pane} is not a shell at its prompt`);
					const briefPath = join(tmpdir(), "pi-subagents", `${params.name}-${draft.sessionId}.md`);
					await mkdir(dirname(briefPath), { recursive: true });
					await writeFile(briefPath, prompt);
					const args = piArguments({ ...draft, subAgent: false }).map(shellQuote).join(" ");
					await hc(["send", params.pane, `${agentEnv.map((pair) => pair.replace(/=(.*)$/s, (_, value) => `=${shellQuote(value)}`)).join(" ")} pi ${args} -- "$(cat ${shellQuote(briefPath)})"`]);
					terminal = shell.address;
					turnAtLaunch = shell.turn;
				} else {
					const where = await placement({
						cwd: params.cwd,
						tab: agentTabName({ name: params.name, tab: params.tab }),
						workspace: params.workspace ?? (await callerPlacement()).space,
						otherSpaceTab: params.name,
					});
					const piArgs = piArguments({ ...draft, subAgent: !orchestrator });
					const argv = [
						"env", ...agentEnv, ...(orchestrator ? [] : SUB_AGENT_ENV),
						"zsh", "-lic", 'exec pi "$@"', "pi", ...piArgs, "--", prompt,
					];
					terminal = await runTerminal({ cwd: params.cwd, where, name: params.name, argv, parent: orchestrator ? "self-outlived" : "self" });
				}

				const launch: Launch = { ...draft, terminal, turnAtLaunch };
				launches.set(launch.name, launch);
				reports.delete(launch.name);
				pi.appendEntry(LAUNCH_ENTRY, launch);
				if (launch.orchestrator) orchestratorsWorking.add(launch.name);
				watchTurns(launch, turnAtLaunch);

				const result = { name: launch.name, pane: terminal, session: launch.session };
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
						const terminal = report ? undefined : await hcTerminal(launch.terminal);
						const status =
							report?.outcome ?? (terminal?.state === "live" ? `running (${terminal.status?.state ?? "starting"})` : "gone");
						launch.session ??= await sessionFileForId(sessionsRoot, launch.sessionId);
						const stats = launch.session ? await summarize(launch.session).catch(() => undefined) : undefined;
						return {
							name: launch.name,
							status,
							pane: launch.terminal,
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
			name: "subagent_send",
			label: "Message sub-agent",
			description: "Type text into a running sub-agent or orchestrator and press Enter, to steer it. No reply is returned; its report arrives as usual.",
			parameters: Type.Object({ name: Type.String(), text: Type.String() }),
			outputSchema: Type.Object({ name: Type.String(), sent: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const launch = launches.get(params.name);
				if (!launch) throw new Error(`no sub-agent named ${params.name}`);
				const terminal = await hcTerminal(launch.terminal);
				if (terminal?.state !== "live") throw new Error(`${params.name}'s terminal is closed`);
				// A reported sub-agent is no longer watched: watch it again from its current
				// turn, so the turn this message starts reports back.
				if (!launch.orchestrator && reports.has(launch.name)) {
					reports.delete(launch.name);
					watchTurns(launch, terminal.turn);
				}
				await hc(["send", launch.terminal, params.text]);
				return reply({ name: launch.name, sent: true });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "subagent_stop",
			label: "Stop sub-agent",
			description: "End a sub-agent's terminal and close its pane, running or not. No completion message follows.",
			parameters: Type.Object({ name: Type.String() }),
			outputSchema: Type.Object({ name: Type.String(), closed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const launch = launches.get(params.name);
				if (!launch) throw new Error(`no sub-agent named ${params.name}`);
				stopWatching(launch.name);
				orchestratorsWorking.delete(launch.name);
				if (!reports.has(launch.name) || launch.orchestrator) {
					reports.set(launch.name, { name: launch.name, outcome: "stopped", reply: "", session: launch.session });
					pi.appendEntry(REPORTED_ENTRY, { name: launch.name, outcome: "stopped" });
				}
				const closed = await closeTerminal(launch.terminal);
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
				"Create a git worktree for a branch in ~/.herdr/worktrees/<repo>/<branch> as its own Herdr space with ONE tab named after the task, holding rootPane (a shell, or pi when startPi is true); the person's view stays where it was. Setup (ship create --bare or install, .env copies) runs in a hidden background terminal after this returns. serve true also starts the dev server in a hidden terminal; dev_server does it later. Slices: pass parent (a branch) and branch becomes the slice name: it creates <parent>--<branch> based on parent, records the parent, makes NO space and returns { path, branch }; start the slice agent with subagent_launch({ cwd: path }). Pass startPi false to keep rootPane a free shell for subagent_launch({ pane: rootPane, orchestrator: true }).",
			parameters: Type.Object({
				cwd: Type.String({ description: "Any directory in the repository" }),
				branch: Type.String({ description: "Branch to check out; created when missing. With parent: the slice name" }),
				base: Type.Optional(Type.String({ description: "Base ref for a new branch; default the HEAD of cwd's checkout, or parent for a slice" })),
				parent: Type.Optional(Type.String({ description: "Make a slice of this branch" })),
				task: Type.Optional(Type.String({ description: "Space and tab name; default the branch without prefix, title-cased" })),
				serve: Type.Optional(Type.Boolean({ description: "Start the dev server in a hidden terminal once setup is done; default false" })),
				startPi: Type.Optional(Type.Boolean({ description: "Start pi in the tab; default true" })),
			}),
			outputSchema: Type.Object({
				workspace: Type.Optional(Type.String()),
				path: Type.String(),
				branch: Type.String(),
				rootPane: Type.Optional(Type.String()),
			}),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				const checkout = await gitCheckout(params.cwd);
				if (!checkout) throw new Error(`${params.cwd} is not in a git repository`);
				const { top, main } = checkout;
				const branch = params.parent ? sliceBranchName({ parent: params.parent, slice: params.branch }) : params.branch;
				const path = join(WORKTREE_ROOT, main.split("/").pop()!, worktreeFolderName(branch));
				const branchExists = await git(main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false);
				if (params.parent) await git(main, ["show-ref", "--verify", "--quiet", `refs/heads/${params.parent}`]).catch(() => {
					throw new Error(`no parent branch ${params.parent}`);
				});
				const base = params.base ?? params.parent ?? "HEAD";
				await git(top, branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base]);
				if (params.parent) await git(main, ["config", `branch.${branch}.herdrParent`, params.parent]);

				if (params.parent) {
					await startCheckoutSetup({ main, path, branch, space: (await callerPlacement()).space });
					return reply({ path, branch });
				}
				const task = params.task ?? taskFromBranch(branch);
				const shownSpace = (await herdrApp<{ space?: string }>(["status"])).space;
				const space = await runAppCommand<{ space: string; tab: string; terminal: string }>("space.new", {
					folder: path,
					tab: task,
					name: task,
					machine: "",
					...(params.startPi === false ? {} : { argv: ["env", "HERDR_ROLE=orchestrator", `HERDR_TASK=${task.slice(0, TASK_LIMIT)}`, "pi"] }),
				});
				const setupTerminal = await startCheckoutSetup({ main, path, branch, space: space.space });
				if (params.serve) await startDevTerminal({ main, path, branch, space: space.space, setupTerminal });
				if (shownSpace) await runAppCommand("space.select", { id: shownSpace });
				return reply({ workspace: space.space, path, branch, rootPane: space.terminal });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "worktree_list",
			label: "List worktrees",
			description: "The repository's linked worktrees as a tree: slices nest under their parent. Each has branch, space id (none for slices), dirty, merged (into its parent, else the default branch) and ship workspace.",
			parameters: Type.Object({ cwd: Type.String({ description: "Any directory in the repository" }) }),
			outputSchema: Type.Object({ worktrees: Type.Array(Type.Any()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const checkout = await gitCheckout(params.cwd);
				if (!checkout) throw new Error(`${params.cwd} is not in a git repository`);
				const { main } = checkout;
				const listed = await git(main, ["worktree", "list", "--porcelain"]);
				const linked = listed
					.split("\n\n")
					.map((block) => ({
						path: block.match(/^worktree (.+)$/m)?.[1],
						branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1],
					}))
					.filter((w): w is { path: string; branch: string } => !!w.path && !!w.branch && w.path !== main);
				const [spaces, mainBranch] = await Promise.all([appSpaces(), defaultBranch(main)]);
				const entries = await Promise.all(
					linked.map(async ({ path, branch }): Promise<WorktreeEntry> => {
						const realPath = await realpath(path).catch(() => path);
						const parent = await worktreeParent({ main, branch });
						const folders = await Promise.all(spaces.map(async (s) => ({ id: s.id, folder: s.folder ? await realpath(s.folder).catch(() => s.folder!) : undefined })));
						return {
							path,
							branch,
							parent,
							space: folders.find((f) => f.folder === realPath)?.id,
							dirty: !!(await commandOutput("git", ["status", "--porcelain"], path)),
							merged: await isBranchMerged({ main, branch, into: parent ?? mainBranch }),
							ship: (await shipWorkspaceAtPath(path))?.project,
						};
					}),
				);
				return reply({ worktrees: worktreeTree(entries) });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "worktree_remove",
			label: "Remove worktree",
			description:
				"Remove a worktree: closes its space (when it has one) and every terminal running in it, hidden ones too, and deletes the checkout folder; uncommitted work in it is lost. In a ship project ship then tears the rest down (route, database, registry); the branch stays when it holds unpushed commits. A slice not merged into its parent is refused unless force. Only when the user asked for it.",
			parameters: Type.Object({
				workspace: Type.Optional(Type.String({ description: "The worktree's space id" })),
				path: Type.Optional(Type.String({ description: "The worktree's folder; for slices, which have no space" })),
				force: Type.Optional(Type.Boolean({ description: "Remove even with uncommitted changes or an unmerged slice" })),
			}),
			outputSchema: Type.Object({ workspace: Type.Optional(Type.String()), path: Type.String(), removed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				if ((params.workspace === undefined) === (params.path === undefined)) throw new Error("pass exactly one of workspace and path");
				const spaces = await appSpaces();
				let space = spaces.find((s) => s.id === params.workspace);
				if (params.workspace && !space?.folder) throw new Error(`no space ${params.workspace} with a folder`);
				const folder = space?.folder ?? params.path!;
				if (!space) {
					const realFolder = await realpath(folder).catch(() => folder);
					for (const s of spaces) if (s.folder && (await realpath(s.folder).catch(() => s.folder!)) === realFolder) space = s;
				}
				if (space && space.id === (await callerPlacement()).space) throw new Error("refusing to remove the space this agent runs in");
				const checkout = await gitCheckout(folder);
				if (!checkout || checkout.main === checkout.top) throw new Error(`${folder} is not a linked git worktree`);
				const top = await realpath(checkout.top).catch(() => checkout.top);
				const self = await hcTerminal(ownTerminal());
				if (self && isInside(await realpath(self.cwd).catch(() => self.cwd), top)) throw new Error("refusing to remove the worktree this agent runs in");
				const branch = await git(checkout.top, ["rev-parse", "--abbrev-ref", "HEAD"]);
				const parent = await worktreeParent({ main: checkout.main, branch });
				if (parent && !params.force && !(await isBranchMerged({ main: checkout.main, branch, into: parent })))
					throw new Error(`${branch} is not merged into ${parent}; merge it or pass force`);
				const dirty = await git(checkout.top, ["status", "--porcelain"]);
				if (dirty && !params.force) throw new Error(`${checkout.top} has uncommitted changes; pass force to lose them`);
				const shipWorkspace = await shipWorkspaceAtPath(checkout.top);
				if (space) await runAppCommand("space.close", { id: space.id, confirmed: true });
				const terminals = new Set([
					...(space?.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.terminal)) ?? []),
					...(await liveTerminalsInside(top)),
				]);
				await Promise.all([...terminals].map((terminal) => closeTerminal(terminal)));
				await git(checkout.main, ["worktree", "remove", ...(dirty || params.force ? ["--force"] : []), checkout.top]);
				if (shipWorkspace) {
					const down = await commandOutput("ship", ["down", shipWorkspace.project, shipWorkspace.branch, "--force"], checkout.main, 120_000);
					if (down === undefined) throw new Error(`worktree removed, but ship down ${shipWorkspace.project} ${shipWorkspace.branch} failed; re-run it`);
				}
				return reply({ workspace: space?.id, path: checkout.top, removed: true });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_list",
			label: "List terminals",
			description: "Terminals of a space with their tab name, cwd, and the agent and its status when one runs there. pane is the terminal address the pane_* tools take.",
			parameters: Type.Object({ workspace: Type.Optional(Type.String({ description: "Space id; default this space" })) }),
			outputSchema: Type.Object({ panes: Type.Array(Type.Any()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				const self = ownTerminal();
				const workspace = params.workspace ?? (await callerPlacement()).space;
				if (!workspace) throw new Error("this terminal is in no space; pass workspace");
				const space = (await appSpaces()).find((s) => s.id === workspace);
				if (!space) throw new Error(`no space ${workspace}`);
				const rows = space.tabs.flatMap((tab) => tab.terminals.map((terminal) => ({ tab, terminal })));
				const panes = await Promise.all(
					rows.map(async ({ tab, terminal }) => {
						const info = await hcTerminal(terminal.terminal);
						return {
							pane: terminal.terminal,
							tab: tab.name,
							cwd: info?.foreground?.cwd ?? info?.cwd,
							agent: terminal.app ?? undefined,
							agentName: terminal.name ?? undefined,
							status: terminal.status ?? undefined,
							self: terminal.terminal === self || undefined,
						};
					}),
				);
				return reply({ panes });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_open",
			label: "Open terminal",
			description:
				"Open a shell terminal as a pane, focus kept, in the space whose checkout holds cwd: in your own tab when that is your space, else in a tab named terminal; tab puts it in a tab of that name. Runs command in it when given (watchers, tests). A dev server command (ship up, pnpm dev, vite) opens no tab: it returns the checkout's hidden dev server as dev_server does.",
			parameters: Type.Object({
				cwd: Type.String({ description: "Absolute working directory" }),
				tab: Type.Optional(Type.String({ description: "Tab name; default none, your own tab" })),
				workspace: Type.Optional(Type.String({ description: "Override the space id; default the one whose checkout holds cwd" })),
				command: Type.Optional(Type.String()),
			}),
			outputSchema: Type.Object({ pane: Type.Optional(Type.String()), url: Type.Optional(Type.String()), devServer: Type.Optional(Type.Boolean()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				if (params.command && DEV_SERVER_COMMAND.test(params.command)) {
					const server = await ensureDevServer({ cwd: params.cwd, workspace: params.workspace });
					return reply({ pane: server.pane, url: server.url, devServer: true });
				}
				const where = await placement({ cwd: params.cwd, tab: params.tab, workspace: params.workspace, otherSpaceTab: "terminal" });
				const pane = await runTerminal({ cwd: params.cwd, where, parent: "none" });
				if (params.command) await hc(["send", pane, params.command]);
				return reply({ pane });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "dev_server",
			label: "Dev server",
			description:
				"The dev server of the checkout that holds cwd: its ship URL and its hidden background terminal (labels herdr.bg=dev, herdr.url; the status bar shows it). Starts it only when the URL does not answer, then waits up to 3 min for it. Use it instead of starting a server yourself.",
			parameters: Type.Object({
				cwd: Type.String({ description: "Absolute directory inside the checkout" }),
				workspace: Type.Optional(Type.String({ description: "Override the space id; default the one whose checkout holds cwd" })),
			}),
			outputSchema: Type.Object({ url: Type.Optional(Type.String()), pane: Type.Optional(Type.String()), started: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				return reply(await ensureDevServer({ cwd: params.cwd, workspace: params.workspace }));
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_run",
			label: "Run in terminal",
			description: "Type a command into a terminal's shell and press Enter. Returns at once; follow with pane_wait or pane_read.",
			parameters: Type.Object({ pane: Type.String({ description: "Terminal address (t7) or name" }), command: Type.String() }),
			outputSchema: Type.Object({ pane: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				if (params.pane === ownTerminal()) throw new Error("that is this agent's own terminal");
				await hc(["send", params.pane, params.command]);
				return reply({ pane: params.pane });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_read",
			label: "Read terminal",
			description: "The last lines of a terminal's screen and history.",
			parameters: Type.Object({ pane: Type.String({ description: "Terminal address (t7) or name" }), lines: Type.Optional(Type.Number({ description: "Default 80" })) }),
			outputSchema: Type.Object({ pane: Type.String(), text: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				const lines = params.lines ?? 80;
				const text = await hcText(["read", params.pane, "--lines", String(lines)]);
				return reply({ pane: params.pane, text: lastLines(text, lines) });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_wait",
			label: "Wait for terminal output",
			description:
				"Wait until a terminal's recent output has a line matching text or regex (JavaScript syntax, one line at a time). Output already on screen matches at once, and so does the command line pane_run typed: match what the command prints, not its own text. Fails on timeout or when the program exits first.",
			parameters: Type.Object({
				pane: Type.String({ description: "Terminal address (t7) or name" }),
				match: Type.Optional(Type.String({ description: "Literal substring" })),
				regex: Type.Optional(Type.String()),
				timeoutMs: Type.Number({ description: "At most 600000" }),
			}),
			outputSchema: Type.Object({ pane: Type.String(), line: Type.String() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				ownTerminal();
				if ((params.match === undefined) === (params.regex === undefined)) throw new Error("pass exactly one of match and regex");
				const pattern = params.regex !== undefined ? new RegExp(params.regex) : undefined;
				const line = await waitForLine({
					terminal: params.pane,
					matches: pattern ? (l) => pattern.test(l) : (l) => l.includes(params.match!),
					waitText: params.match ?? "",
					timeoutMs: Math.min(params.timeoutMs, 600_000),
				});
				return reply({ pane: params.pane, line });
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "pane_close",
			label: "Close terminal",
			description: "End a terminal and close its pane. Only terminals you opened, or when the user asked.",
			parameters: Type.Object({ pane: Type.String({ description: "Terminal address (t7) or name" }) }),
			outputSchema: Type.Object({ pane: Type.String(), closed: Type.Boolean() }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				if (params.pane === ownTerminal()) throw new Error("that is this agent's own terminal");
				return reply({ pane: params.pane, closed: await closeTerminal(params.pane) });
			},
		}),
	);
}
