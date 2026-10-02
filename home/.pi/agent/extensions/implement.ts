import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const IMPLEMENT_SKILL = "/Users/tim/.agents/skills/implement/SKILL.md";

type Slice = { number: string; title: string; done: boolean };

function parseSlices(spec: string): Slice[] {
	const section = spec.split(/^## Slices[ \t]*\r?$/m)[1]?.split(/^## /m)[0];
	if (section === undefined) return [];

	return [...section.matchAll(/^- \[([ xX])\] (\d+)\. (.+)$/gm)].map(([, check, number, description]) => ({
		number,
		title: description.split(" — ")[0].trim(),
		done: check.toLowerCase() === "x",
	}));
}

async function selectSlice(path: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const spec = await readFile(path, "utf8");
	const slices = parseSlices(spec);
	if (slices.length === 0) {
		if (/^## Slices[ \t]*\r?$/m.test(spec)) {
			ctx.ui.notify(`Cannot parse numbered checkbox slices in ${path}`, "error");
			return undefined;
		}
		return ""; // An unsliced spec is implemented as a whole.
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("Specify a slice when running /implement without a UI", "warning");
		return undefined;
	}

	const next = slices.find((slice) => !slice.done);
	const ordered = next ? [next, ...slices.filter((slice) => slice !== next)] : slices;
	if (!next) ctx.ui.notify("All slices are marked done. Select one to rerun or cancel.", "info");
	const choices = ordered.map((slice) =>
		`${slice.number}. ${slice.title} (${slice === next ? "next" : slice.done ? "done" : "pending"})`,
	);
	const choice = await ctx.ui.select(`Slice · ${basename(path)}`, choices);
	return choice === undefined ? undefined : ordered[choices.indexOf(choice)].number;
}

function splitArgs(args: string): { path: string; slice: string } | undefined {
	const trimmed = args.trim();
	if (!trimmed) return undefined;
	const match = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/);
	if (!match) return undefined;
	return { path: match[1] ?? match[2] ?? match[3], slice: match[4]?.trim() ?? "" };
}

export default function implement(pi: ExtensionAPI) {
	pi.registerCommand("implement", {
		description: "Select an approved plan and its next slice, or supply a spec path and slice",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before starting /implement", "warning");
				return;
			}

			let target = splitArgs(args);
			if (!target) {
				if (args.trim()) {
					ctx.ui.notify('Usage: /implement ["spec-path" [slice]]', "warning");
					return;
				}
				if (!ctx.hasUI) {
					ctx.ui.notify("Usage: /implement <spec-path> [slice]", "warning");
					return;
				}
				const directory = join(ctx.cwd, "plans");
				let plans: string[];
				try {
					plans = (await readdir(directory, { withFileTypes: true }))
						.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
						.map((entry) => entry.name)
						.sort();
				} catch (error) {
					ctx.ui.notify(`Cannot read ${directory}: ${String(error)}`, "error");
					return;
				}
				if (plans.length === 0) {
					ctx.ui.notify(`No Markdown plans in ${directory}`, "warning");
					return;
				}
				const choices = await Promise.all(plans.map(async (name) => {
					let status: string;
					try {
						const spec = await readFile(join(directory, name), "utf8");
						const slices = parseSlices(spec);
						const done = slices.filter((slice) => slice.done).length;
						const next = slices.find((slice) => !slice.done);
						status = slices.length > 0
							? `${done}/${slices.length} done${next ? ` · next: ${next.number}` : " · complete"}`
							: /^## Slices[ \t]*\r?$/m.test(spec) ? "invalid slices" : "no slices";
					} catch {
						status = "unreadable";
					}
					return `${name} — ${status}`;
				}));
				const selected = await ctx.ui.select("Select a plan", choices);
				if (selected === undefined) return;
				target = { path: join(directory, plans[choices.indexOf(selected)]), slice: "" };
			}

			const path = isAbsolute(target.path) ? target.path : resolve(ctx.cwd, target.path);
			try {
				if (!(await stat(path)).isFile()) {
					ctx.ui.notify(`Not a file: ${path}`, "error");
					return;
				}
				if (!target.slice) {
					const slice = await selectSlice(path, ctx);
					if (slice === undefined) return;
					target.slice = slice;
				}
			} catch (error) {
				ctx.ui.notify(`Cannot read ${path}: ${String(error)}`, "error");
				return;
			}

			pi.sendUserMessage(
				`Implement this approved work: ${path}\n${target.slice ? `Slice: ${target.slice}\n` : ""}\nRead \`${IMPLEMENT_SKILL}\` completely and follow it. Treat the supplied spec${target.slice ? ", limited to that slice," : ""} as the full implementation scope. Do not load standards prose on top of the spec.`,
			);
		},
	});
}
