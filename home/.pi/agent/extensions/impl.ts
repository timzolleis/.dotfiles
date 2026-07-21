/**
 * Plan → implementation handoff via tree rewind.
 *
 * Workflow:
 *   1. During exploration, when context feels right: /impl-mark
 *      (labels the current leaf "pre-plan" — the rewind target)
 *   2. Do the socratic/planning dance; write the finalized plan to
 *      plans/<name>.md (Plannotator does this on submit).
 *   3. /impl [name-or-focus...] — reads the plan from plans/*.md, rewinds to
 *      the "pre-plan" entry (the exploration branch is model-summarized), and
 *      attaches the plan file's contents untouched as a custom message.
 *
 * Plan selection: bare /impl uses the most-recently-modified plans/*.md. An
 * arg that resolves to a file (plans/<arg>.md, plans/<arg>, or <arg>) selects
 * that plan; any other arg is treated as extra focus for the summarizer.
 */

import { promises as fs } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

const MARK_LABEL = "pre-plan";
const PLANS_DIR = "plans";

const EXPLORATION_FOCUS = `
This branch was a planning session. The finalized implementation plan is
carried over separately and verbatim — do NOT reproduce, summarize, or
reference its steps here.

Summarize only the supporting context an implementer needs alongside that plan:

1. CODEBASE FACTS — concrete discoveries from exploration: file paths,
   existing patterns to follow, API signatures, gotchas.
2. DECISIONS & CONSTRAINTS — choices made during planning and WHY, including
   approaches considered and rejected (so they aren't re-attempted).
3. OPEN EDGE CASES — anything flagged but deferred.

Omit conversational back-and-forth. The reader has no other context beyond
this summary and the verbatim plan.`.trim();

type SelectedPlan = { path: string; content: string };

const readFileIfExists = async (path: string): Promise<string | undefined> => {
	try {
		const stat = await fs.stat(path);
		if (!stat.isFile()) return undefined;
		return await fs.readFile(path, "utf8");
	} catch {
		// ENOENT / EISDIR — treat any access failure as "not a plan file here".
		return undefined;
	}
};

/**
 * Resolve which plan file to use. If `arg` names an existing file (as
 * plans/<arg>.md, plans/<arg>, or <arg> relative to cwd), that plan is chosen
 * and no extra focus is carried. Otherwise the plan is the most-recently-
 * modified plans/*.md and `arg` (if any) becomes summarizer focus.
 */
const selectPlan = async (
	arg: string,
	cwd: string,
): Promise<
	| { ok: true; plan: SelectedPlan; extraFocus: string }
	| { ok: false; error: string }
> => {
	const plansDir = resolve(cwd, PLANS_DIR);

	if (arg) {
		const candidates = [
			resolve(plansDir, `${arg}.md`),
			resolve(plansDir, arg),
			isAbsolute(arg) ? arg : resolve(cwd, arg),
		];
		for (const candidate of candidates) {
			const content = await readFileIfExists(candidate);
			if (content !== undefined) {
				return { ok: true, plan: { path: candidate, content }, extraFocus: "" };
			}
		}
	}

	let names: string[];
	try {
		names = await fs.readdir(plansDir);
	} catch {
		return { ok: false, error: `No ${PLANS_DIR}/ directory in ${cwd}` };
	}

	const mdFiles = names.filter((name) => name.endsWith(".md"));
	if (mdFiles.length === 0) {
		return { ok: false, error: `No ${PLANS_DIR}/*.md plan files in ${cwd}` };
	}

	const withMtime = await Promise.all(
		mdFiles.map(async (name) => {
			const path = resolve(plansDir, name);
			const stat = await fs.stat(path);
			return { path, mtimeMs: stat.mtimeMs };
		}),
	);
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const chosen = withMtime[0];
	const content = await fs.readFile(chosen.path, "utf8");

	return { ok: true, plan: { path: chosen.path, content }, extraFocus: arg };
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("impl-mark", {
		description: `Label the current point as "${MARK_LABEL}" — the /impl rewind target`,
		handler: async (_args, ctx) => {
			const leaf = ctx.sessionManager.getLeafEntry();
			if (!leaf) {
				ctx.ui.notify("Session is empty — nothing to mark", "warning");
				return;
			}

			// Move the label if one already exists so there's only ever one target.
			for (const entry of ctx.sessionManager.getEntries()) {
				if (ctx.sessionManager.getLabel(entry.id) === MARK_LABEL) {
					pi.setLabel(entry.id, undefined);
				}
			}

			pi.setLabel(leaf.id, MARK_LABEL);
			ctx.ui.notify(`Marked current point as "${MARK_LABEL}"`, "info");
		},
	});

	pi.registerCommand("impl", {
		description: `Rewind to "${MARK_LABEL}": exploration summarized, plan read from ${PLANS_DIR}/*.md (args: plan name or extra focus)`,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const branch = ctx.sessionManager.getBranch();
			const markIndex = branch.findIndex(
				(entry) => ctx.sessionManager.getLabel(entry.id) === MARK_LABEL,
			);
			if (markIndex === -1) {
				ctx.ui.notify(
					`No "${MARK_LABEL}" entry on this branch — run /impl-mark first (or Shift+L in /tree)`,
					"error",
				);
				return;
			}
			const target = branch[markIndex];
			if (target.id === ctx.sessionManager.getLeafId()) {
				ctx.ui.notify("Already at the marked entry — nothing to rewind", "warning");
				return;
			}

			const selection = await selectPlan(args.trim(), ctx.cwd);
			if (!selection.ok) {
				ctx.ui.notify(`${selection.error} — aborting rewind`, "error");
				return;
			}
			const { plan, extraFocus } = selection;
			ctx.ui.notify(`Using ${basename(plan.path)}`, "info");

			const customInstructions = extraFocus
				? `${EXPLORATION_FOCUS}\n\nAdditional focus: ${extraFocus}`
				: EXPLORATION_FOCUS;

			// navigateTree with summarize runs a full LLM call over the abandoned
			// branch; the extension bridge shows no indicator, so we wrap it in a
			// focus-holding loader (blocks the editor for the duration). Not
			// cancellable: abortBranchSummary() isn't exposed to extensions.
			const result = await ctx.ui.custom<
				{ cancelled: boolean } | { error: unknown }
			>((tui, theme, _keybindings, done) => {
				const loader = new BorderedLoader(
					tui,
					theme,
					`Summarizing exploration branch (LLM call), then rewinding to "${MARK_LABEL}"...`,
					{ cancellable: false },
				);
				ctx
					.navigateTree(target.id, {
						summarize: true,
						customInstructions,
						replaceInstructions: false,
						label: "impl-briefing",
					})
					.then(done, (error) => done({ error }));
				return loader;
			});

			if ("error" in result) {
				const message = result.error instanceof Error ? result.error.message : String(result.error);
				ctx.ui.notify(`Rewind failed: ${message}`, "error");
				return;
			}
			if (result.cancelled) {
				ctx.ui.notify("Rewind cancelled — plan not carried over", "warning");
				return;
			}

			// Queued for the next user prompt; participates in LLM context untouched.
			pi.sendMessage(
				{
					customType: "impl-plan",
					content: `Finalized implementation plan (human-reviewed, authoritative — follow exactly):\n\n${plan.content}`,
					display: true,
				},
				{ deliverAs: "nextTurn" },
			);

			ctx.ui.notify("Rewound — exploration summarized, plan attached verbatim. Say 'go' to implement.", "info");
		},
	});
}
