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

export default function planModeTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "enter_plan_mode",
		label: "Enter Plan Mode",
		description:
			"Switch this session into Plannotator plan mode. Call this BEFORE touching any code when the user asks for a non-trivial implementation task — a new feature, a refactor or rewrite, or any change spanning multiple files — unless the user explicitly asked to skip planning or a plan for this task was already approved. In plan mode you explore the codebase, write a markdown plan file, and submit it with plannotator_submit_plan for human review; execution starts only after approval. Do not call this for trivial one-line fixes, pure questions, or exploration-only requests.",
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
							text: "Plan mode is now active. Explore the codebase, write your plan (with the locked interface spec) to a markdown file in the working directory, then submit it with plannotator_submit_plan.",
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
