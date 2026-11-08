import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Says in the Herdr agents list who this agent is, through the
 * `herdr.role`, `herdr.task` and `herdr.branch` labels of its own terminal.
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
		// The default spinner changes every 80 ms, and Herdr redraws its whole window for each
		// change of a visible terminal. Herdr shows working in the sidebar and tab; the turn timer ticks.
		ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("accent", "◐")] });
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

	// ~/.config/herdr-app/AGENTS.md is rewritten by the app on every start and runs to 1000 lines
	// (about 15k tokens); inside that folder pi would load all of it into every session.
	// Send an outline and let the agent read the section it needs.
	pi.on("before_agent_start", async (event) => {
		for (const file of event.systemPromptOptions.contextFiles ?? []) {
			if (!file.path.endsWith("/herdr-app/AGENTS.md") || file.content.length < 8000) continue;
			const outline = file.content
				.split("\n")
				.flatMap((line, index) => (/^#{1,3} /.test(line) ? [`${index + 1}: ${line}`] : []))
				.join("\n");
			file.content = `The Herdr app's interface docs are in ${file.path} (${file.content.split("\n").length} lines), not loaded here. Before changing layouts, keys, commands, settings or mods, read the sections you need with read (offset/limit) from this outline (line: heading):\n\n${outline}`;
		}
	});

	pi.on("session_shutdown", async () => {
		await writeLabels({ "herdr.now": "" });
	});
}
