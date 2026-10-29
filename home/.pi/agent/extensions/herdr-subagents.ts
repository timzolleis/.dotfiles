import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Pi sub-agents in herdr panes. `subagent_launch` starts one and returns at
 * once; when it settles, its final reply and cost arrive in this session as a
 * message that starts a turn. Launches are recorded as session entries, so a
 * reload re-attaches to agents that are still running.
 */

const LAUNCH_ENTRY = "subagent-launch";
const REPORTED_ENTRY = "subagent-reported";
const REPLY_LIMIT = 6000;
const SUB_AGENT_ENV = ["PLANNOTATOR_INBOX_TOOL=0", "PLANNOTATOR_AGENT_TOOL=0", "PI_SUBAGENT=1"];
const SHOT_PATTERN = /\bpnpm\s+(?:-s\s+)?shot\b|\bshot\s+(?:publish|outline|flow)\b/;

interface Launch {
	name: string;
	pane: string;
	cwd: string;
	model: string;
	thinking: string;
	session?: string;
	keepOpen: boolean;
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

async function openPane(cwd: string, tabLabel: string): Promise<string> {
	const workspace = process.env.HERDR_WORKSPACE_ID;
	if (!workspace) throw new Error("not running inside herdr (HERDR_WORKSPACE_ID unset)");
	const env = SUB_AGENT_ENV.flatMap((kv) => ["--env", kv]);
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

		const head = `Sub-agent ${launch.name} ${report.outcome === "done" ? "finished" : "failed"}${report.stats ? `: ${formatStats(report.stats)}` : ""}`;
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
		name: "subagents",
		description: "Pi sub-agents in herdr panes. Completion arrives as a `Sub-agent <name> finished` message; never wait or poll for it.",
	};

	pi.registerTool(
		defineTool({
			name: "subagent_launch",
			label: "Launch sub-agent",
			description:
				"Start a pi agent in a new herdr pane (sub-agent tab, split from the largest pane, focus kept) and send it a brief. Returns at once. When the agent settles, its final reply, cost, shot runs and image reads arrive as a message that starts a turn, and its pane closes unless keepOpen. The sub-agent has the Plannotator Inbox and agent tools off.",
			parameters: Type.Object({
				name: Type.String({ description: "Unique herdr agent name, [a-z][a-z0-9_-]{0,31}; also pi's session name" }),
				cwd: Type.String({ description: "Absolute working directory" }),
				model: Type.String({ description: "pi --model, e.g. anthropic/claude-sonnet-5-5" }),
				thinking: Type.String({ description: "pi --thinking: off|minimal|low|medium|high|xhigh|max" }),
				briefFile: Type.Optional(Type.String({ description: "Path of the brief to send; or pass prompt" })),
				prompt: Type.Optional(Type.String({ description: "Brief text; or pass briefFile" })),
				tab: Type.Optional(Type.String({ description: "Tab label in the current workspace; default spec-flow" })),
				keepOpen: Type.Optional(Type.Boolean({ description: "Keep the pane after it finishes; default false" })),
			}),
			outputSchema: Type.Object({ name: Type.String(), pane: Type.String(), session: Type.Optional(Type.String()) }),
			exposure: "codemode",
			namespace,
			async execute(_id, params) {
				if (process.env.HERDR_ENV !== "1") throw new Error("not running inside herdr");
				if (!/^[a-z][a-z0-9_-]{0,31}$/.test(params.name)) throw new Error(`invalid agent name: ${params.name}`);
				if ((params.briefFile === undefined) === (params.prompt === undefined)) throw new Error("pass exactly one of briefFile and prompt");
				const running = launches.get(params.name);
				if (running && !reports.has(params.name)) throw new Error(`${params.name} is still running`);
				const prompt = params.prompt ?? (await readFile(params.briefFile!, "utf8"));

				const pane = await openPane(params.cwd, params.tab ?? "spec-flow");
				await herdr(
					["agent", "start", params.name, "--kind", "pi", "--pane", pane, "--",
						"--model", params.model, "--thinking", params.thinking, "--name", params.name],
					90_000,
				);
				const launch: Launch = {
					name: params.name,
					pane,
					cwd: params.cwd,
					model: params.model,
					thinking: params.thinking,
					session: (await agentInfo(params.name))?.agent_session?.value,
					keepOpen: params.keepOpen ?? false,
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
}
