import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PLAN_APPROVED_CHANNEL = "plannotator:plan-approved";
const IMPL_MODEL = "anthropic/claude-opus-5-5";
const READ_CODE_STYLE = "Read ~/.agents/skills/code-style/SKILL.md completely before the first edit.";
const RUN_HERE = "Run here (compact first)";
const HAND_TO_OPUS = "Hand to Opus in a worktree";

interface PlanApprovedEvent {
	cwd: string;
	planFilePath: string;
	planContent: string;
	feedback?: string;
}

const COMPACTION_INSTRUCTIONS = `The plan in this session was just approved and is about to be implemented from this summary. Write the summary for the agent that implements it.
Keep: the goal, the decisions made and why, the constraints and conventions found in the codebase, options rejected and why, open risks, and the files and symbols the plan touches.
Drop: exploration dead ends, tool output, earlier plan drafts and review rounds. The approved plan file is the source of truth; do not restate it.`;

function reviewerNotesSection(feedback: string | undefined): string {
	return feedback ? `\n\nReviewer notes from the approval (guidance, not a change request):\n${feedback}` : "";
}

function executePromptFromPlan(event: PlanApprovedEvent, planPath: string): string {
	return `The plan at ${planPath} is approved. Read it again and implement it step by step. ${READ_CODE_STYLE} Test as you go.${reviewerNotesSection(event.feedback)}`;
}

function orchestratorPromptFromPlan(event: PlanApprovedEvent, planPath: string): string {
	return `The plan at ${planPath} is approved. Hand it to an implementation agent; do not implement it yourself:
1. worktree_create({ space: false }) on a branch named after the plan's job.
2. subagent_launch an impl agent in that worktree, named after the job (impl-<job>), model ${IMPL_MODEL}. Brief: implement the approved plan at ${planPath} (absolute path in the main checkout), test it, and commit on the branch. The brief also says: "${READ_CODE_STYLE}"${reviewerNotesSection(event.feedback)}
Then end your turn; its report arrives as a message.`;
}

export default function (pi: ExtensionAPI) {
	if (process.env.T3_PI_MCP_EXTENSION_PATH) return;
	const hasHerdrTools = Boolean(process.env.HC_TERMINAL_ID) && process.env.PI_SUBAGENT !== "1";
	let sessionCtx: ExtensionContext | undefined;
	let handoffWaitingForIdle: PlanApprovedEvent | undefined;

	async function runApprovedPlan(ctx: ExtensionContext, event: PlanApprovedEvent): Promise<void> {
		const planPath = resolve(event.cwd, event.planFilePath);
		const choices = hasHerdrTools ? [HAND_TO_OPUS, RUN_HERE] : [RUN_HERE];
		const choice = ctx.hasUI && choices.length > 1 ? await ctx.ui.select("Approved plan:", choices) : choices[0];
		if (!choice) return;

		if (choice === HAND_TO_OPUS) {
			pi.sendUserMessage(orchestratorPromptFromPlan(event, planPath));
			return;
		}

		ctx.compact({
			customInstructions: COMPACTION_INSTRUCTIONS,
			onComplete: () => pi.sendUserMessage(executePromptFromPlan(event, planPath)),
			onError: (error) => ctx.ui.notify(`Plan handoff: compaction failed, plan not started. ${error.message}`, "error"),
		});
	}

	pi.on("session_start", (_event, ctx) => {
		sessionCtx = ctx;
		handoffWaitingForIdle = undefined;
	});

	pi.on("agent_settled", (_event, ctx) => {
		const event = handoffWaitingForIdle;
		if (!event) return;
		handoffWaitingForIdle = undefined;
		void runApprovedPlan(ctx, event);
	});

	pi.events.on(PLAN_APPROVED_CHANNEL, (data) => {
		const event = data as PlanApprovedEvent;
		if (!sessionCtx) return;
		if (sessionCtx.isIdle()) void runApprovedPlan(sessionCtx, event);
		else handoffWaitingForIdle = event;
	});
}
