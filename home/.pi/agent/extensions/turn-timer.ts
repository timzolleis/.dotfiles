import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Turn timer — footer status segment. While a turn is running it shows a
 * live elapsed counter; when idle it shows how long the last turn took,
 * when it finished, and how long ago that was, e.g.:
 *
 *   Turn: going for 42s
 *   Turn: 1m 23s · ended 14:32 (3m ago)
 *
 * A "turn" is one full agent run: agent_start (prompt submitted) to
 * agent_settled (run fully settled, including retries and continuations).
 * On session start the last turn is restored from the session branch.
 */

const STATUS_KEY = "turn-timer";
const IDLE_TICK_MS = 10_000;
const RUNNING_TICK_MS = 1_000;

interface LastTurn {
	readonly durationMs: number;
	readonly finishedAt: number; // epoch ms
}

type TurnTimerState =
	| { phase: "idle"; last: LastTurn | undefined }
	| { phase: "running"; startedAt: number; last: LastTurn | undefined };

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = String(totalMinutes % 60).padStart(2, "0");
	return `${hours}h ${minutes}m`;
}

export function formatClock(epochMs: number): string {
	const date = new Date(epochMs);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

export function formatAgo(nowMs: number, finishedAtMs: number): string {
	const seconds = Math.max(0, Math.floor((nowMs - finishedAtMs) / 1000));
	if (seconds < 10) return "just now";
	if (seconds < 60) return `${Math.floor(seconds / 10) * 10}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ago`;
}

export function renderStatus(
	state: TurnTimerState,
	nowMs: number,
): string | undefined {
	if (state.phase === "running") {
		return `Turn: going for ${formatDuration(nowMs - state.startedAt)}`;
	}
	const last = state.last;
	if (last === undefined) return undefined;
	return `Turn: ${formatDuration(last.durationMs)} · ended ${formatClock(last.finishedAt)} (${formatAgo(nowMs, last.finishedAt)})`;
}

/**
 * Reconstruct the last completed turn from the session branch: the last
 * user message starts it, the last assistant message after it ends it.
 */
function lastTurnFromBranch(ctx: ExtensionContext): LastTurn | undefined {
	let startMs: number | undefined;
	let endMs: number | undefined;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const role = entry.message.role;
		const ms = Date.parse(entry.timestamp);
		if (Number.isNaN(ms)) continue;
		if (role === "user") {
			startMs = ms;
			endMs = undefined;
		} else if (role === "assistant" && startMs !== undefined) {
			endMs = ms;
		}
	}

	if (startMs === undefined || endMs === undefined || endMs < startMs) {
		return undefined;
	}
	return { durationMs: endMs - startMs, finishedAt: endMs };
}

export default function turnTimer(pi: ExtensionAPI) {
	let state: TurnTimerState = { phase: "idle", last: undefined };
	let timer: ReturnType<typeof setInterval> | undefined;
	let currentCtx: ExtensionContext | undefined;

	const publish = () => {
		if (currentCtx === undefined) return;
		const text = renderStatus(state, Date.now());
		currentCtx.ui.setStatus(
			STATUS_KEY,
			text === undefined ? undefined : currentCtx.ui.theme.fg("dim", text),
		);
	};

	const reschedule = () => {
		if (timer !== undefined) clearInterval(timer);
		timer = setInterval(
			publish,
			state.phase === "running" ? RUNNING_TICK_MS : IDLE_TICK_MS,
		);
		timer.unref?.();
	};

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		state = { phase: "idle", last: lastTurnFromBranch(ctx) };
		reschedule();
		publish();
	});

	pi.on("agent_start", (_event, ctx) => {
		currentCtx = ctx;
		state = { phase: "running", startedAt: Date.now(), last: state.last };
		reschedule();
		publish();
	});

	pi.on("agent_settled", (_event, ctx) => {
		currentCtx = ctx;
		if (state.phase !== "running") return;
		const now = Date.now();
		state = {
			phase: "idle",
			last: { durationMs: now - state.startedAt, finishedAt: now },
		};
		reschedule();
		publish();
	});

	pi.on("session_shutdown", () => {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
		currentCtx = undefined;
	});
}
