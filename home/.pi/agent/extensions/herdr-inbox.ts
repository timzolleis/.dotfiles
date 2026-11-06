import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * The Herdr Inbox: messages, questions and guided reviews from pi to the person,
 * shown by the herdr-app `inbox` mod and the `changes-plus` guide view.
 *
 * One JSON file per item in `<herdr-app home>/data/inbox/items/<id>.json` (a guide's
 * patch beside it as `<id>.patch`). This extension writes items; the mods write the
 * person's answer, read and archive marks into the same file. An answer to an item
 * this session sent comes back as a follow-up message, once.
 */

const APP_HOME = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const ITEMS = join(APP_HOME, "data/inbox/items");
const STEPS = join(APP_HOME, "data/inbox/steps");
const DELIVERED_ENTRY = "herdr-inbox-delivered";

type Choice = { label: string; description?: string };
type Question = { key: string; prompt: string; context?: string; kind: "single" | "multi" | "text"; choices: Choice[]; recommended?: string; stopped?: boolean; withdrawn?: boolean };
type Answer = { key: string; picked?: string[]; text?: string; skipped?: boolean };
// Something only the person can do; the answer says whether they did.
type Action = { key: string; text: string; detail?: string; withdrawn?: boolean };
type VerifyStep = { key: string; text: string };
// A comment on one block of a message, a chapter overview or an attached file.
// target: "body" | "chapter:<n>" | "file:<path>"; block counts from 0; line is set for code files.
type Annotation = { target: string; block: number; quote: string; text: string; line?: number };
type Comment = { section?: number; file?: string; line?: number; side?: "old" | "new"; code?: string; text: string };
type Item = {
	v: 1;
	id: string;
	kind: "message" | "guide" | "verify" | "reply";
	created_at: string;
	from: { terminal?: string; session: string; name?: string; cwd: string; root?: string; branch?: string };
	subject: string;
	thread?: string;
	body: string;
	questions: Question[];
	actions?: Action[];
	verify?: { url?: string; steps: VerifyStep[] };
	attachments?: string[];
	reply_to?: string;
	guide?: unknown;
	withdrawn_at?: string;
	state: "open" | "answered" | "done";
	read_at?: string | null;
	archived_at?: string | null;
	answer?: {
		at: string;
		answers?: Answer[];
		actions?: Array<{ key: string; done: boolean }>;
		verify?: Array<{ key: string; result: "pass" | "fail"; note?: string }>;
		annotations?: Annotation[];
		note?: string;
		verdict?: "approve" | "changes";
		comments?: Comment[];
	};
};

const git = (cwd: string, args: string[]) =>
	new Promise<string | undefined>((resolve) =>
		execFile("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout)),
	);

const newId = () => `ibx_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

async function writeItem(item: Item, patch?: string) {
	await mkdir(ITEMS, { recursive: true });
	if (patch !== undefined) await writeFile(join(ITEMS, `${item.id}.patch`), patch);
	const tmp = join(ITEMS, `.${item.id}.json.tmp`);
	await writeFile(tmp, `${JSON.stringify(item, null, 1)}\n`);
	await rename(tmp, join(ITEMS, `${item.id}.json`));
}

async function readItem(id: string): Promise<Item | undefined> {
	try {
		return JSON.parse(await readFile(join(ITEMS, `${id}.json`), "utf8"));
	} catch {
		return undefined;
	}
}

async function allItems(): Promise<Item[]> {
	const names = await readdir(ITEMS).catch(() => [] as string[]);
	const items = await Promise.all(names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).map((n) => readItem(n.slice(0, -5))));
	return items.filter((i): i is Item => !!i);
}

// The branch's whole change, as a PR would show it: merge-base with the base ref
// against the working tree, untracked files included. The base is the one asked for,
// else the parent slice branch (git config branch.<b>.herdrParent), else main.
async function branchPatch(root: string, branch: string | undefined, base?: string): Promise<{ patch: string; base: string } | undefined> {
	const parent = !base && branch ? (await git(root, ["config", "--get", `branch.${branch}.herdrParent`]))?.trim() : undefined;
	const refs = base ? [base] : [...(parent ? [parent, `origin/${parent}`] : []), "origin/main", "origin/master", "main", "master"];
	for (const ref of refs) {
		const base = (await git(root, ["merge-base", ref, "HEAD"]))?.trim();
		if (!base) continue;
		const tracked = (await git(root, ["diff", "--no-color", "--no-ext-diff", base])) ?? "";
		const untracked = ((await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])) ?? "").split("\0").filter(Boolean);
		const fresh = await Promise.all(
			untracked.map(
				(path) =>
					new Promise<string>((resolve) =>
						execFile("git", ["-C", root, "diff", "--no-color", "--no-index", "--", "/dev/null", path], { maxBuffer: 16 * 1024 * 1024 }, (_e, stdout) => resolve(stdout ?? "")),
					),
			),
		);
		return { patch: tracked + fresh.join(""), base: ref };
	}
	return undefined;
}

// An item still waiting on the person: an open question, action, verify or guide.
function needsPerson(item: Item): boolean {
	if (item.answer || item.archived_at || item.withdrawn_at || item.kind === "reply") return false;
	return item.kind === "guide" || item.kind === "verify" || item.questions.some((q) => !q.withdrawn) || Boolean(item.actions?.some((a) => !a.withdrawn));
}

function patchFiles(patch: string): string[] {
	return [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((m) => (m[2] === "dev/null" ? m[1] : m[2]));
}

// `:::question`, `:::question-multi`, `:::question-text` and `:::action` blocks in a
// message body (Plannotator's syntax) become questions and actions; the rest is the body.
// First line is the prompt (the action's text), `- [ ] label` lines are choices,
// `Recommended: label` names the pick, any other line is context. Fenced code is left alone.
export function parseBody(text: string): { body: string; questions: Array<Omit<Question, "key">>; actions: Array<Omit<Action, "key">> } {
	const kept: string[] = [];
	const questions: Array<Omit<Question, "key">> = [];
	const actions: Array<Omit<Action, "key">> = [];
	const lines = text.split("\n");
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*```/.test(lines[i])) fenced = !fenced;
		const open = fenced ? null : /^:::(question-multi|question-text|question|action)\s*$/.exec(lines[i].trim());
		if (!open) {
			kept.push(lines[i]);
			continue;
		}
		const inner: string[] = [];
		for (i++; i < lines.length && lines[i].trim() !== ":::"; i++) inner.push(lines[i]);
		const at = inner.findIndex((l) => l.trim());
		const [first, ...rest] = at < 0 ? [] : inner.slice(at).map((l) => l.trimEnd());
		const head = (first ?? "").trim();
		if (!head) continue;
		if (open[1] === "action") {
			actions.push({ text: head, detail: rest.join("\n").trim() || undefined });
			continue;
		}
		const choices: Choice[] = [];
		const context: string[] = [];
		let recommended: string | undefined;
		for (const line of rest) {
			const choice = /^\s*[-*]\s*\[[ xX]?\]\s*(.+)$/.exec(line);
			const rec = /^\s*Recommended:\s*(.+)$/i.exec(line);
			if (choice) choices.push({ label: choice[1].trim() });
			else if (rec) recommended = rec[1].trim();
			else context.push(line);
		}
		const free = open[1] === "question-text" || !choices.length;
		questions.push({
			prompt: head,
			context: context.join("\n").trim() || undefined,
			kind: free ? "text" : open[1] === "question-multi" ? "multi" : "single",
			choices: free ? [] : choices,
			recommended: !free ? choices.find((c) => c.label.toLowerCase() === recommended?.toLowerCase())?.label : undefined,
		});
	}
	return { body: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), questions, actions };
}

const quoted = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

export function formatAnswer(item: Item): string {
	const a = item.answer!;
	if (item.kind === "reply") return [`Herdr Inbox: the person replied${item.thread ? ` in "${item.thread}"` : ""} (to ${item.reply_to ?? item.id})`, "", a.note ?? ""].join("\n");
	const lines = [`Herdr Inbox: the person answered "${item.subject}" (${item.id})`];
	if (item.kind === "guide") lines.push("", `Review: ${a.verdict === "approve" ? "Looks good" : a.verdict === "changes" ? "Changes requested" : "Commented"}`);
	for (const c of a.comments ?? []) {
		if (c.line !== undefined && c.file) {
			lines.push("", `\`${c.file}:${c.line}\`${c.side === "old" ? " (removed line)" : ""}`);
			if (c.code?.trim()) lines.push(quoted(c.code));
			lines.push(c.text);
		} else lines.push(`- ${c.file ? `\`${c.file}\`` : c.section !== undefined ? `Chapter ${c.section + 1}` : "General"}: ${c.text}`);
	}
	for (const [i, ans] of (a.answers ?? []).entries()) {
		const q = item.questions.find((x) => x.key === ans.key);
		lines.push("", `Q${i + 1}. ${q?.prompt ?? ans.key}`);
		if (ans.skipped) lines.push("Skipped.");
		if (ans.picked?.length) lines.push(`Picked: ${ans.picked.join(", ")}`);
		if (ans.text) lines.push(`${ans.picked?.length ? "Note" : "Answer"}: ${ans.text}`);
	}
	if (a.actions?.length) {
		lines.push("", "Actions:");
		for (const x of a.actions) lines.push(`- [${x.done ? "x" : " "}] ${item.actions?.find((y) => y.key === x.key)?.text ?? x.key}${x.done ? "" : " (not done)"}`);
	}
	if (a.verify?.length || item.verify) {
		lines.push("", `Verification${item.verify?.url ? ` of ${item.verify.url}` : ""}:`);
		for (const step of item.verify?.steps ?? []) {
			const r = a.verify?.find((x) => x.key === step.key);
			lines.push(`- [${r?.result === "pass" ? "x" : " "}] ${step.text}: ${r ? (r.result === "pass" ? "pass" : "FAIL") : "not checked"}${r?.note ? ` (${r.note})` : ""}`);
		}
	}
	const where = (t: string) => (t === "body" ? "the message" : t.startsWith("chapter:") ? `the overview of chapter ${Number(t.slice(8)) + 1}` : `\`${t.slice(5)}\``);
	for (const n of a.annotations ?? []) {
		lines.push("", n.line !== undefined && n.target.startsWith("file:") ? `\`${n.target.slice(5)}:${n.line}\`` : `On ${where(n.target)}:`);
		lines.push(quoted(n.quote), n.text);
	}
	if (a.note) lines.push("", `Note: ${a.note}`);
	return lines.join("\n");
}

const QuestionSchema = Type.Object({
	prompt: Type.String({ description: "The decision, one sentence" }),
	context: Type.Optional(Type.String({ description: "One to three plain sentences: what it affects, what you know, why you recommend one. Markdown." })),
	choices: Type.Optional(Type.Array(Type.String(), { description: "Choices in their natural order; omit for a free-text answer. Never add an Other choice: the person can always write their own." })),
	recommended: Type.Optional(Type.String({ description: "The label of the choice you recommend, exactly as in choices" })),
	multi: Type.Optional(Type.Boolean({ description: "Several choices may be picked" })),
	stopped: Type.Optional(Type.Boolean({ description: "You cannot go on until it is answered" })),
});

export default function (pi: ExtensionAPI) {
	if (!process.env.HC_TERMINAL_ID) return;

	let sessionId = "";
	let sessionName: string | undefined;
	const delivered = new Set<string>();
	let watcher: FSWatcher | undefined;
	let scanTimer: ReturnType<typeof setTimeout> | undefined;

	const deliver = async () => {
		if (!sessionId) return;
		await updateNow();
		for (const item of await allItems()) {
			if (item.from.session !== sessionId || !item.answer || delivered.has(item.id)) continue;
			delivered.add(item.id);
			pi.appendEntry(DELIVERED_ENTRY, { id: item.id });
			pi.sendMessage(
				{ customType: "herdr-inbox-reply", content: formatAnswer(item), display: true, details: { id: item.id, answer: item.answer } },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		}
	};

	// herdr.now: "Needs you: <subject>" while an item of this session waits on the person,
	// else the thread's doing step (or whatever the identity extension set, if we never wrote).
	let doing = "";
	let lastNow: string | undefined;
	const updateNow = async () => {
		const waiting = (await allItems()).filter((i) => i.from.session === sessionId && needsPerson(i)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
		const want = (waiting ? `Needs you: ${waiting.subject}` : doing).slice(0, 60);
		if (want === lastNow || (lastNow === undefined && !want)) return;
		lastNow = want;
		execFile("hc", ["label", process.env.HC_TERMINAL_ID!, `herdr.now=${want}`], () => {});
	};
	const scanSoon = () => {
		if (scanTimer) clearTimeout(scanTimer);
		scanTimer = setTimeout(() => void deliver(), 250);
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		sessionId = ctx.sessionManager.getSessionId();
		sessionName = ctx.sessionManager.getSessionName();
		delivered.clear();
		for (const entry of ctx.sessionManager.getEntries() as any[])
			if (entry.type === "custom" && entry.customType === DELIVERED_ENTRY) delivered.add(entry.data.id);
		await mkdir(ITEMS, { recursive: true });
		watcher?.close();
		watcher = watch(ITEMS, scanSoon);
		await deliver();
	});

	pi.on("session_shutdown", async () => {
		watcher?.close();
		watcher = undefined;
		if (scanTimer) clearTimeout(scanTimer);
	});

	const origin = async (cwd: string) => {
		const root = (await git(cwd, ["rev-parse", "--show-toplevel"]))?.trim();
		const branch = root ? (await git(root, ["branch", "--show-current"]))?.trim() || undefined : undefined;
		return { terminal: process.env.HC_TERMINAL_ID, session: sessionId, name: sessionName, cwd, root, branch };
	};

	// One thread per work stream: a later message with the same thread name joins it.
	// Default: the branch of cwd, or the session name on main/master (or outside git).
	const threadOf = (thread: string | undefined, branch: string | undefined) =>
		thread?.trim() || (branch && !/^(main|master)$/.test(branch) ? branch : sessionName?.trim()) || undefined;

	// Withdraws open questions/actions of this session's items: `id` for the whole item, `id/qkey` for one.
	const supersede = async (refs: string[]) => {
		const withdrawn: string[] = [];
		for (const ref of refs) {
			const [id, key] = ref.split("/");
			const item = await readItem(id);
			if (!item || item.from.session !== sessionId || item.answer) continue;
			if (key) {
				const target = item.questions.find((q) => q.key === key) ?? item.actions?.find((a) => a.key === key);
				if (!target) continue;
				target.withdrawn = true;
			} else {
				item.withdrawn_at = new Date().toISOString();
				item.state = "done";
			}
			await writeItem(item);
			withdrawn.push(ref);
		}
		return withdrawn;
	};

	pi.registerTool(
		defineTool({
			name: "inbox_send",
			label: "Inbox: send",
			description:
				"Message the person in the Herdr Inbox (a panel in their Herdr window); nothing blocks. Use it for a decision only they can make (questions), finished long work (a short summary), or when they ask. Questions render as answerable cards. Their answer arrives in this session by itself as a message headed 'Herdr Inbox: the person answered'; end your turn or keep working.",
			promptSnippet: "Message the person or ask them a decision in the Herdr Inbox; the answer comes back by itself",
			promptGuidelines: [
				"Use inbox_send for a decision only the person can make (one question each, choices in natural order, your pick in recommended) and for a short summary of finished long work; then keep working on what does not wait on the answer.",
				"Use inbox_send with the same thread name for every message of one work stream (default: the branch).",
				"Only a question, action or verify pings the person; a plain message is a quiet update. Put questions in the body as :::question / :::question-multi / :::question-text blocks (first line the prompt, then context lines, `- [ ] choice` lines, `Recommended: <label>`) and things only they can do as :::action blocks. Use verify for steps they check in a running app. Use supersedes to withdraw a question you no longer need.",
				"Use inbox_steps to keep the thread's plan (todo, doing, done, waiting) current.",
				"Use inbox_guide, not inbox_send, to hand over a finished code change for review.",
			],
			parameters: Type.Object({
				subject: Type.String({ description: "One line, plain text" }),
				body: Type.Optional(Type.String({ description: "Markdown. Lead with the point; short. May hold :::question, :::question-multi, :::question-text and :::action blocks." })),
				thread: Type.Optional(Type.String({ description: "Work stream name; same name, same thread. Default: the branch (the session name on main)" })),
				questions: Type.Optional(Type.Array(QuestionSchema, { maxItems: 8 })),
				verify: Type.Optional(
					Type.Object(
						{ url: Type.String({ description: "Where to look" }), steps: Type.Array(Type.String(), { minItems: 1, maxItems: 20, description: "Each step the person marks pass or fail" }) },
						{ description: "Ask the person to check something in a running app" },
					),
				),
				reply_to: Type.Optional(Type.String({ description: "Id of an inbox item: this message joins that item's thread" })),
				supersedes: Type.Optional(Type.Array(Type.String(), { description: "Item ids, or item-id/question-key, whose open questions you withdraw" })),
				attachments: Type.Optional(Type.Array(Type.String(), { description: "File paths the person can read and comment on (markdown shown, others as code)" })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const parsed = parseBody(params.body ?? "");
				const asked: Array<Omit<Question, "key">> = [
					...(params.questions ?? []).map((q) => ({
						prompt: q.prompt,
						context: q.context,
						kind: (q.choices?.length ? (q.multi ? "multi" : "single") : "text") as Question["kind"],
						choices: (q.choices ?? []).map((label) => ({ label })),
						recommended: q.recommended && q.choices?.includes(q.recommended) ? q.recommended : undefined,
						stopped: q.stopped || undefined,
					})),
					...parsed.questions,
				].slice(0, 12);
				const questions: Question[] = asked.map((q, i) => ({ ...q, key: `q${i + 1}` }));
				const actions: Action[] = parsed.actions.map((a, i) => ({ ...a, key: `a${i + 1}` }));
				const from = await origin(ctx.cwd);
				const replied = params.reply_to ? await readItem(params.reply_to) : undefined;
				if (params.reply_to && !replied) throw new Error(`no inbox item ${params.reply_to}`);
				const item: Item = {
					v: 1,
					id: newId(),
					kind: params.verify ? "verify" : "message",
					created_at: new Date().toISOString(),
					from,
					subject: params.subject.split("\n")[0].trim(),
					thread: params.thread?.trim() || replied?.thread || threadOf(undefined, from.branch),
					body: parsed.body,
					questions,
					...(actions.length ? { actions } : {}),
					...(params.verify ? { verify: { url: params.verify.url, steps: params.verify.steps.map((text, i) => ({ key: `s${i + 1}`, text })) } } : {}),
					...(params.attachments?.length ? { attachments: params.attachments.map((p) => resolve(ctx.cwd, p)) } : {}),
					...(params.reply_to ? { reply_to: params.reply_to } : {}),
					state: questions.length || actions.length || params.verify ? "open" : "done",
					read_at: null,
				};
				await writeItem(item);
				const withdrawn = params.supersedes?.length ? await supersede(params.supersedes) : [];
				void updateNow();
				const asks = [questions.length && `${questions.length} question(s)`, actions.length && `${actions.length} action(s)`, params.verify && `${params.verify.steps.length} verify step(s)`].filter(Boolean);
				const text = `Sent to the Herdr Inbox (${item.id})${asks.length ? `, ${asks.join(", ")}; the answer arrives as a message` : " as a quiet update"}${withdrawn.length ? `; withdrew ${withdrawn.join(", ")}` : ""}.`;
				return { content: [{ type: "text", text }], details: { id: item.id } };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "inbox_guide",
			label: "Inbox: guided review",
			description:
				"Hand the person a guided review of a finished code change in Herdr: chapters ordered by importance, each with an overview and the files it covers. It opens in the Changes panel, where they step through it and approve or request changes; their verdict and comments arrive as a message. Without patch, the branch's whole change against main is sent (committed, uncommitted and untracked). Every changed file goes in exactly one chapter or in unplacedFiles; diffs[].file is the exact path from the diff. Chapters: implementation heart first, consequences next, glue last; 2-6 usually, 10 at most. Overviews: 2-6 short plain sentences on what changed, why, and what it implies; no verdicts, no em-dashes, no emoji.",
			promptSnippet: "Hand over a finished code change as a guided review the person steps through in Herdr",
			parameters: Type.Object({
				title: Type.String(),
				intent: Type.String({ description: "1-2 sentences: why the change exists" }),
				sections: Type.Array(
					Type.Object({
						title: Type.String({ description: "Concept-level, never a file name" }),
						overview: Type.String({ description: "Markdown, 2-6 sentences" }),
						diffs: Type.Array(Type.Object({ file: Type.String(), summary: Type.String({ description: "1-2 sentences on this file's change" }) })),
					}),
					{ minItems: 1, maxItems: 10 },
				),
				unplacedFiles: Type.Optional(Type.Array(Type.String())),
				body: Type.Optional(Type.String({ description: "A short note shown with it in the Inbox" })),
				thread: Type.Optional(Type.String({ description: "Default: the branch (the session name on main)" })),
				base: Type.Optional(Type.String({ description: "Ref to diff against; default: the parent slice branch (git config branch.<b>.herdrParent), else main" })),
				patch: Type.Optional(Type.String({ description: "Unified diff to review; default: git diff <merge-base with base>, untracked files too" })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const from = await origin(ctx.cwd);
				let patch = params.patch;
				let base: string | undefined;
				if (!patch) {
					if (!from.root) throw new Error("not in a git repository; pass patch");
					const made = await branchPatch(from.root, from.branch, params.base);
					if (!made) throw new Error(params.base ? `cannot diff against ${params.base}; pass another base or patch` : "no main branch to diff against; pass patch");
					({ patch, base } = made);
				}
				const files = patchFiles(patch);
				if (!files.length) throw new Error("the patch has no file diffs");
				const placed = params.sections.flatMap((s) => s.diffs.map((d) => d.file));
				const unknown = placed.filter((f) => !files.includes(f));
				const twice = placed.filter((f, i) => placed.indexOf(f) !== i);
				if (unknown.length) throw new Error(`not in the patch: ${unknown.join(", ")}. Changed files: ${files.join(", ")}`);
				if (twice.length) throw new Error(`placed twice: ${[...new Set(twice)].join(", ")}`);
				const unplaced = files.filter((f) => !placed.includes(f));
				const item: Item = {
					v: 1,
					id: newId(),
					kind: "guide",
					created_at: new Date().toISOString(),
					from,
					subject: params.title,
					thread: threadOf(params.thread, from.branch),
					body: params.body ?? "",
					questions: [],
					guide: { title: params.title, intent: params.intent, sections: params.sections, unplacedFiles: unplaced, base, files },
					state: "open",
					read_at: null,
				};
				await writeItem(item, patch);
				void updateNow();
				const text = `Guided review sent to the Herdr Inbox (${item.id}): ${params.sections.length} chapters, ${files.length} files${unplaced.length ? `, ${unplaced.length} under Everything else` : ""}. The verdict arrives as a message.`;
				return { content: [{ type: "text", text }], details: { id: item.id } };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "inbox_steps",
			label: "Inbox: steps",
			description:
				"Set the thread's plan: ordered steps with a status (todo, doing, done, waiting). Shown in the thread header in the Herdr Inbox, and the doing step is this agent's current-step label. Send the whole list each time.",
			promptSnippet: "Keep the thread's plan (todo, doing, done, waiting) current in the Herdr Inbox",
			parameters: Type.Object({
				thread: Type.Optional(Type.String({ description: "Default: the branch (the session name on main)" })),
				steps: Type.Array(Type.Object({ title: Type.String(), status: Type.Union([Type.Literal("todo"), Type.Literal("doing"), Type.Literal("done"), Type.Literal("waiting")]) }), { maxItems: 20 }),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const from = await origin(ctx.cwd);
				const thread = threadOf(params.thread, from.branch);
				if (!thread) throw new Error("no thread: pass one");
				await mkdir(STEPS, { recursive: true });
				const file = join(STEPS, `${encodeURIComponent(thread)}.json`);
				await writeFile(`${file}.tmp`, `${JSON.stringify({ thread, steps: params.steps, session: sessionId, terminal: from.terminal, updated_at: new Date().toISOString() }, null, 1)}\n`);
				await rename(`${file}.tmp`, file);
				doing = params.steps.find((s) => s.status === "doing")?.title ?? "";
				await updateNow();
				return { content: [{ type: "text", text: `Steps for "${thread}": ${params.steps.filter((s) => s.status === "done").length}/${params.steps.length} done.` }], details: {} };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "inbox_read",
			label: "Inbox: read",
			description: "List the items this session sent to the Herdr Inbox with their state and answers, or one item in full by id.",
			parameters: Type.Object({ id: Type.Optional(Type.String()) }),
			async execute(_id, params) {
				if (params.id) {
					const item = await readItem(params.id);
					if (!item) throw new Error(`no inbox item ${params.id}`);
					return { content: [{ type: "text", text: JSON.stringify(item, null, 1) }], details: {} };
				}
				const mine = (await allItems()).filter((i) => i.from.session === sessionId).sort((a, b) => a.created_at.localeCompare(b.created_at));
				const text = mine.length
					? mine.map((i) => `${i.id} ${i.kind} ${i.state}${i.answer ? " answered" : ""}${i.read_at ? " read" : ""}: ${i.subject}`).join("\n")
					: "Nothing sent from this session.";
				return { content: [{ type: "text", text }], details: {} };
			},
		}),
	);
}
