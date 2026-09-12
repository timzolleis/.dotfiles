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

/** Enter Plannotator for the final design checks and human approval of a written spec. */
export default function planModeTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "enter_plan_mode",
		label: "Enter Plan Mode",
		description:
			"Enter Plannotator for human approval of a spec that is already written. Follow AGENTS.md and the tech-spec skill: typed contracts, call graph, files, and test slices as TypeScript pseudocode, not prose. Submit with plannotator_submit_plan. Most work does not need this \u2014 the user normally reviews a spec inline as a message annotation. Do not call this for trivial fixes, questions, exploration-only requests, or /implement with an approved spec. After approval, run /implement <spec-path> [slice].",
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
							text: "Plan mode is active. Follow the Plannotator planning instructions and AGENTS.md. Use the tech-spec outline, preserve the agreed code-shaped design, and submit with plannotator_submit_plan only after the lock gate passes.",
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
