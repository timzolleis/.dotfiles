export interface SkillUsage {
	readonly skill: string;
	invocations: number;
	skillFileReads: number;
	referenceReads: number;
	readonly sessions: Set<string>;
	readonly repos: Map<string, number>;
}

export interface SessionUsageInput {
	readonly sessionId: string;
	readonly repo: string;
	readonly lines: ReadonlyArray<string>;
}

const skillFilePattern = /skills\/([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9._/-]+\.md)/g;
const shellReadPattern = /^\s*(?:cat|head|tail|less|bat|sed)\b/;
const invocationPattern = /<skill name=\\?"([a-z0-9][a-z0-9-]*)\\?"/g;

type UsageKind = "invocation" | "skillFileRead" | "referenceRead";

interface UsageEvent {
	readonly skill: string;
	readonly kind: UsageKind;
}

const readKind = (file: string): UsageKind => (file === "SKILL.md" ? "skillFileRead" : "referenceRead");

const readEventsFromPath = (path: string): ReadonlyArray<UsageEvent> =>
	[...path.matchAll(skillFilePattern)].map(([, skill, file]) => ({ skill, kind: readKind(file) }));

const readEventsFromShellCommand = (command: string): ReadonlyArray<UsageEvent> =>
	command
		.split(/&&|;|\||\n/)
		.filter((segment) => shellReadPattern.test(segment))
		.flatMap(readEventsFromPath);

const textFromContent = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n");
};

const eventsFromEntry = (entry: {
	readonly type?: string;
	readonly message?: { readonly role?: string; readonly content?: unknown };
}): ReadonlyArray<UsageEvent> => {
	if (entry.type !== "message" || !entry.message) return [];
	const { role, content } = entry.message;
	if (role === "user")
		return [...textFromContent(content).matchAll(invocationPattern)].map(([, skill]) => ({ skill, kind: "invocation" }));
	if (role !== "assistant" || !Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (part?.type !== "toolCall") return [];
		const name = String(part.name ?? "").toLowerCase();
		if (name === "read" && typeof part.arguments?.path === "string") return readEventsFromPath(part.arguments.path);
		if (name === "bash" && typeof part.arguments?.command === "string")
			return readEventsFromShellCommand(part.arguments.command);
		return [];
	});
};

export const skillUsageFromSessions = (sessions: ReadonlyArray<SessionUsageInput>): ReadonlyMap<string, SkillUsage> => {
	const usageBySkill = new Map<string, SkillUsage>();
	for (const { sessionId, repo, lines } of sessions) {
		for (const line of lines) {
			if (!line.includes("skill")) continue;
			let entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			for (const { skill, kind } of eventsFromEntry(entry)) {
				const usage =
					usageBySkill.get(skill) ??
					{ skill, invocations: 0, skillFileReads: 0, referenceReads: 0, sessions: new Set(), repos: new Map() };
				if (kind === "invocation") usage.invocations += 1;
				if (kind === "skillFileRead") usage.skillFileReads += 1;
				if (kind === "referenceRead") usage.referenceReads += 1;
				usage.sessions.add(sessionId);
				usage.repos.set(repo, (usage.repos.get(repo) ?? 0) + 1);
				usageBySkill.set(skill, usage);
			}
		}
	}
	return usageBySkill;
};
