/**
 * Plan → implementation handoff via tree rewind.
 *
 * Workflow:
 *   1. During exploration, when context feels right: /impl-mark
 *      (labels the current leaf "pre-plan" — the rewind target)
 *   2. Do the socratic/planning dance, iterate with /plannotator-last
 *      until the plan is finalized (it need not be the last message).
 *   3. /impl [extra focus...] — an LLM extraction pass locates the
 *      finalized plan in the planning segment and returns it verbatim
 *      (folding in any revisions from annotation rounds). Then pi rewinds
 *      to the "pre-plan" entry: the exploration branch is model-summarized,
 *      and the extracted plan is attached untouched as a custom message.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const MARK_LABEL = "pre-plan";

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

const EXTRACTION_PROMPT = `
The conversation below is a planning session for a software change. Somewhere
in it, the assistant produced an implementation plan, possibly revised across
several messages in response to review feedback (annotations).

Your job is EXTRACTION, not summarization:

- Locate the finalized implementation plan.
- Return it VERBATIM — exact wording, structure, file paths, code, and
  interface signatures. Do not compress, reorder, rephrase, or "improve" it.
- If the plan was revised across messages, reconstruct the final authoritative
  version: start from the most complete plan statement and apply only the
  later agreed revisions, keeping original wording wherever unchanged.
- Output ONLY the plan text. No preamble, no commentary, no code fences
  around the whole output.
- If you cannot find anything resembling an implementation plan, output
  exactly: NO_PLAN_FOUND`.trim();

type TextBlock = { type: "text"; text: string };

const isTextBlock = (block: unknown): block is TextBlock =>
	typeof block === "object" && block !== null &&
	(block as TextBlock).type === "text" && typeof (block as TextBlock).text === "string";

const entryText = (entry: { type: string; message?: { role?: string; content?: unknown } }): string => {
	if (entry.type !== "message" || !entry.message) return "";
	const { content } = entry.message;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter(isTextBlock).map((block) => block.text).join("\n");
};

const extractPlan = async (
	planningSegmentText: string,
	ctx: ExtensionCommandContext,
): Promise<string | undefined> => {
	const model = ctx.model;
	if (!model) {
		ctx.ui.notify("No model selected — cannot extract plan", "error");
		return undefined;
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		ctx.ui.notify(`No credentials for ${model.id} — cannot extract plan`, "error");
		return undefined;
	}

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [
						{
							type: "text" as const,
							text: `<conversation>\n${planningSegmentText}\n</conversation>\n\n${EXTRACTION_PROMPT}`,
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
	);

	const plan = response.content
		.filter(isTextBlock)
		.map((block) => block.text)
		.join("\n")
		.trim();

	if (!plan || plan === "NO_PLAN_FOUND") return undefined;
	return plan;
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
		description: `Rewind to "${MARK_LABEL}": exploration summarized, plan extracted verbatim (args: extra focus)`,
		handler: async (args, ctx) => {
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

			// Only user/assistant text after the mark: the planning segment. Tool
			// output is exploration noise for extraction and blows the budget.
			const planningSegmentText = branch
				.slice(markIndex + 1)
				.filter((entry) => entry.type === "message")
				.map((entry) => {
					const role = (entry as { message: { role: string } }).message.role;
					if (role !== "user" && role !== "assistant") return "";
					const text = entryText(entry).trim();
					return text ? `${role === "user" ? "User" : "Assistant"}: ${text}` : "";
				})
				.filter(Boolean)
				.join("\n\n");

			if (!planningSegmentText) {
				ctx.ui.notify("Nothing after the mark to extract a plan from", "error");
				return;
			}

			ctx.ui.notify("Extracting finalized plan…", "info");
			const plan = await extractPlan(planningSegmentText, ctx);
			if (!plan) {
				ctx.ui.notify("No implementation plan found in the planning segment — aborting rewind", "error");
				return;
			}

			const extraFocus = args.trim();
			const customInstructions = extraFocus
				? `${EXPLORATION_FOCUS}\n\nAdditional focus: ${extraFocus}`
				: EXPLORATION_FOCUS;

			const result = await ctx.navigateTree(target.id, {
				summarize: true,
				customInstructions,
				replaceInstructions: false,
				label: "impl-briefing",
			});

			if (result.cancelled) {
				ctx.ui.notify("Rewind cancelled — plan not carried over", "warning");
				return;
			}

			// Queued for the next user prompt; participates in LLM context untouched.
			pi.sendMessage(
				{
					customType: "impl-plan",
					content: `Finalized implementation plan (human-reviewed, authoritative — follow exactly):\n\n${plan}`,
					display: true,
				},
				{ deliverAs: "nextTurn" },
			);

			ctx.ui.notify("Rewound — exploration summarized, plan attached verbatim. Say 'go' to implement.", "info");
		},
	});
}
