import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Mirrors the documented public event API of @plannotator/pi-extension
// (plannotator-events.ts). The package lives in ~/.pi/agent/npm/node_modules,
// which is not resolvable from this directory, so the channel name and shapes
// are declared locally.
const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const RESPONSE_TIMEOUT_MS = 5_000;

type PlanModeResponse =
	| { status: "handled"; result: { phase: "idle" | "planning" | "executing" } }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

/** Enter Plannotator for the final design checks and human-approved plan-file handoff. */
export default function planModeTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "enter_plan_mode",
		label: "Enter Plan Mode",
		description:
			"Enter Plannotator after context building and design discussion, for final checks and human approval. Follow AGENTS.md and read $HOME/.agents/skills/design-first/PLAN-FORMAT.md before recording the agreed design in plans/<name>.md. Preserve the approved types, interfaces, composition, boundaries, call stacks, constraints, and evaluated decisions; do not reduce them to prose. Submit with plannotator_submit_plan before implementation. Do not call this for trivial fixes, questions, exploration-only requests, explicitly skipped planning, or /implement with an already approved plan. After approval, run /implement <plan-path> in this session or another session.",
		parameters: Type.Object({}),
		async execute() {
			const response = await new Promise<PlanModeResponse | "timeout">((resolve) => {
				const timer = setTimeout(() => resolve("timeout"), RESPONSE_TIMEOUT_MS);
				pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
					requestId: crypto.randomUUID(),
					action: "plan-mode",
					payload: { mode: "enter" },
					respond: (r: PlanModeResponse) => {
						clearTimeout(timer);
						resolve(r);
					},
				});
			});

			if (response === "timeout" || response.status === "unavailable") {
				return {
					content: [
						{
							type: "text" as const,
							text: "Plan mode is unavailable (the Plannotator extension did not respond). Proceed without it: present your plan to the user as a normal message and wait for approval before implementing.",
						},
					],
					details: { phase: "unavailable" },
				};
			}

			if (response.status === "error") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Plan mode could not be entered: ${response.error}. Present your plan as a normal message instead.`,
						},
					],
					details: { phase: "error" },
				};
			}

			const phase = response.result.phase;
			if (phase === "planning") {
				return {
					content: [
						{
							type: "text" as const,
							text: "Plan mode is active. Follow the Plannotator planning instructions and AGENTS.md. Read $HOME/.agents/skills/design-first/PLAN-FORMAT.md, preserve the agreed code-shaped design in plans/<name>.md, and submit with plannotator_submit_plan only after the lock gate passes.",
						},
					],
					details: { phase },
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Plan mode was not entered; the session is already in phase "${phase}". Continue with the current phase.`,
					},
				],
				details: { phase },
			};
		},
	});
}
