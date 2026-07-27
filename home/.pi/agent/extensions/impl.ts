/**
 * Plan → implementation handoff via tree rewind.
 *
 * Workflow:
 *   1. Plan in Plannotator plan mode and approve the plan in the browser.
 *      Plannotator must run with `"executionMode": "external"` so it hands the
 *      approved plan off instead of executing it in the bloated planning
 *      context.
 *   2. On handoff this extension queues `/impl`, which opens the same session
 *      tree picker `/tree` uses.
 *   3. Pick the point to implement from. Everything after it is summarized
 *      into an implementer briefing, and the approved plan is re-attached
 *      verbatim on the fresh branch.
 *   4. Implementation starts immediately, with minimal context.
 *
 * The plan path and contents ride along on the handoff event, so nothing is
 * read from disk and there is no plan file to guess at.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, TreeSelectorComponent } from "@earendil-works/pi-coding-agent";

// Mirrors the documented public event API of @plannotator/pi-extension
// (plannotator-events.ts). The package lives in ~/.pi/agent/npm/node_modules,
// which is not resolvable from this directory, so the channel name and shape
// are declared locally.
const PLANNOTATOR_PLAN_APPROVED_CHANNEL = "plannotator:plan-approved";

const IMPL_COMMAND = "impl";
const BRIEFING_LABEL = "impl-briefing";

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

interface ApprovedPlan {
	readonly planFilePath: string;
	readonly planContent: string;
}

/** Frame the plan so the model treats it as authoritative and starts work. */
const briefing = (plan: ApprovedPlan): string =>
	`Finalized implementation plan from ${plan.planFilePath} (human-reviewed, authoritative — follow exactly). Begin implementing it now.\n\n${plan.planContent}`;

export default function (pi: ExtensionAPI) {
	// Set on handoff, consumed by /impl. Kept on cancel so /impl can retry.
	let approvedPlan: ApprovedPlan | undefined;

	pi.events.on(PLANNOTATOR_PLAN_APPROVED_CHANNEL, (data) => {
		const event = data as Partial<ApprovedPlan> | null;
		if (!event?.planContent?.trim() || !event.planFilePath) return;

		approvedPlan = {
			planFilePath: event.planFilePath,
			planContent: event.planContent,
		};

		// The handoff fires from inside plannotator_submit_plan's execute(), so
		// the turn is still winding down. followUp waits for it to settle, then
		// input routing dispatches the command without an LLM round trip.
		pi.sendUserMessage(`/${IMPL_COMMAND}`, { deliverAs: "followUp" });
	});

	pi.registerCommand(IMPL_COMMAND, {
		// Opens automatically on plan approval; this command is the only way to
		// reach navigateTree (command handlers alone get ExtensionCommandContext),
		// so it doubles as the retry path after cancelling the picker.
		description: "Reopen the rewind picker for a pending approved plan (opens itself on approval)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const plan = approvedPlan;
			if (!plan) {
				ctx.ui.notify(
					"No approved plan pending — approve one in Plannotator first (needs executionMode: external)",
					"warning",
				);
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("The tree picker needs the interactive TUI", "error");
				return;
			}

			await ctx.waitForIdle();

			const tree = ctx.sessionManager.getTree();
			const leafId = ctx.sessionManager.getLeafId();
			if (tree.length === 0) {
				ctx.ui.notify("Session is empty — nothing to rewind to", "warning");
				return;
			}

			// The component /tree itself renders, so the picker behaves identically.
			const targetId = await ctx.ui.custom<string | undefined>(
				(tui, _theme, _keybindings, done) =>
					new TreeSelectorComponent(
						tree,
						leafId,
						tui.terminal.rows,
						(entryId) => done(entryId),
						() => done(undefined),
					),
			);

			if (!targetId) {
				ctx.ui.notify(`Cancelled — plan still pending, run /${IMPL_COMMAND} to retry`, "warning");
				return;
			}

			approvedPlan = undefined;

			// Picking the current leaf means "implement right here"; there is no
			// branch to abandon, so skip the summarizer entirely.
			if (targetId !== leafId) {
				// navigateTree with summarize runs a full LLM call over the abandoned
				// branch; the extension bridge shows no indicator, so we wrap it in a
				// focus-holding loader (blocks the editor for the duration). Not
				// cancellable: abortBranchSummary() isn't exposed to extensions.
				const result = await ctx.ui.custom<{ cancelled: boolean } | { error: unknown }>(
					(tui, theme, _keybindings, done) => {
						const loader = new BorderedLoader(
							tui,
							theme,
							"Summarizing the abandoned branch (LLM call), then rewinding...",
							{ cancellable: false },
						);
						ctx
							.navigateTree(targetId, {
								summarize: true,
								customInstructions: EXPLORATION_FOCUS,
								replaceInstructions: false,
								label: BRIEFING_LABEL,
							})
							.then(done, (error) => done({ error }));
						return loader;
					},
				);

				if ("error" in result) {
					const message =
						result.error instanceof Error ? result.error.message : String(result.error);
					ctx.ui.notify(`Rewind failed: ${message}`, "error");
					return;
				}
				if (result.cancelled) {
					ctx.ui.notify("Rewind cancelled — plan not carried over", "warning");
					return;
				}
			}

			// Lands on the fresh branch and participates in LLM context untouched.
			pi.sendMessage(
				{
					customType: "impl-plan",
					content: briefing(plan),
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		},
	});
}
