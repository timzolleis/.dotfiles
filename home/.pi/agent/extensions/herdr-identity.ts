import { execFile } from "node:child_process";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Says in the Herdr agents list who this agent is and what it does now, through the
 * `herdr.role`, `herdr.task`, `herdr.branch` and `herdr.now` labels of its own terminal.
 */

const TERMINAL = process.env.HC_TERMINAL_ID;
const LABEL_MAX = 60;
const TASK_MAX_WORDS = 6;

export function taskFromMessage(text: string): string {
	const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
	const words = firstLine.trim().split(/\s+/).slice(0, TASK_MAX_WORDS);
	let task = words.join(" ");
	while (task.length > LABEL_MAX) task = task.includes(" ") ? task.slice(0, task.lastIndexOf(" ")) : task.slice(0, LABEL_MAX);
	return task.replace(/[.,;:\s]+$/, "");
}

const run = (command: string, args: string[], cwd?: string) =>
	new Promise<string>((resolve) => execFile(command, args, { cwd, timeout: 5000 }, (_e, stdout) => resolve((stdout ?? "").trim())));

async function roleFromEnvironment(cwd: string): Promise<string> {
	if (process.env.HERDR_ROLE) return process.env.HERDR_ROLE;
	const terminal = JSON.parse((await run("hc", ["get", TERMINAL!, "--json"])) || "{}");
	if (terminal.parent) return "agent";
	const [gitDir, commonDir] = (await run("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], cwd)).split("\n");
	return gitDir && gitDir === commonDir ? "home" : "agent";
}

export default function (pi: ExtensionAPI) {
	if (!TERMINAL) return;

	let task = process.env.HERDR_TASK?.slice(0, LABEL_MAX) ?? "";
	let taskFromUser = Boolean(task);
	// A pi run from a shell inside an agent's terminal (`pi -p`) inherits HC_TERMINAL_ID:
	// only an interactive pi owns the terminal it labels.
	let ownsTerminal = false;

	const writeLabels = async (labels: Record<string, string>) => {
		if (!ownsTerminal) return;
		await run("hc", ["label", TERMINAL, ...Object.entries(labels).map(([key, value]) => `${key}=${value.slice(0, LABEL_MAX)}`)]);
	};

	const showTask = (ctx: ExtensionContext, nextTask: string) => {
		task = nextTask;
		if (task) ctx.ui.setTitle(task);
		return writeLabels({ "herdr.task": task });
	};

	pi.on("session_start", async (_event, ctx) => {
		ownsTerminal = ctx.hasUI;
		if (!ownsTerminal) return;
		const sessionName = pi.getSessionName();
		if (!task && sessionName) task = sessionName.slice(0, LABEL_MAX);
		if (task) ctx.ui.setTitle(task);
		const branch = await run("git", ["branch", "--show-current"], ctx.cwd);
		await writeLabels({ "herdr.role": await roleFromEnvironment(ctx.cwd), "herdr.task": task, "herdr.branch": branch });
	});

	pi.on("session_info_changed", async (event, ctx) => {
		if (taskFromUser || !event.name) return;
		await showTask(ctx, event.name.slice(0, LABEL_MAX));
	});

	pi.on("input", async (event, ctx) => {
		if (task || event.source === "extension") return;
		const derived = taskFromMessage(event.text);
		if (derived) await showTask(ctx, derived);
		return { action: "continue" };
	});

	pi.on("session_shutdown", async () => {
		await writeLabels({ "herdr.now": "" });
	});

	pi.registerTool(
		defineTool({
			name: "agent_status",
			label: "Agent status",
			description: "Show in the Herdr agents list what this agent works on (task) and what it does right now (now).",
			promptSnippet: "Set the task and current step shown for this agent in the Herdr agents list",
			promptGuidelines: [
				"Use agent_status to set task when the person gives you a new piece of work: 2-6 words naming it, like a ticket title.",
				"Use agent_status to set now when you start a new step; keep it under 8 words.",
			],
			parameters: Type.Object({
				task: Type.Optional(Type.String({ description: "What this agent works on, stable, under 60 chars" })),
				now: Type.Optional(Type.String({ description: "The current step, under 8 words; empty clears it" })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (params.task !== undefined) {
					taskFromUser = true;
					await showTask(ctx, params.task);
				}
				if (params.now !== undefined) await writeLabels({ "herdr.now": params.now });
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		}),
	);
}
