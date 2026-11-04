import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { type SessionUsageInput, skillUsageFromSessions } from "./skill-usage.ts";

const ENTRY_TYPE = "skill-stats";
const DEFAULT_DAYS = 14;
const TOP_REPOS_SHOWN = 3;

interface SkillStatsRow {
	readonly skill: string;
	readonly invocations: number;
	readonly skillFileReads: number;
	readonly referenceReads: number;
	readonly sessions: number;
	readonly repos: ReadonlyArray<readonly [string, number]>;
}

interface SkillStatsReport {
	readonly days: number;
	readonly repoFilter: string;
	readonly sessionCount: number;
	readonly rows: ReadonlyArray<SkillStatsRow>;
	readonly neverUsed: ReadonlyArray<string>;
}

const repoFromCwd = (cwd: string): string => {
	const home = homedir();
	const worktree = cwd.match(/\/\.herdr\/worktrees\/([^/]+)/);
	if (worktree) return worktree[1];
	const code = cwd.match(/\/code\/([^/]+)/);
	if (code) return code[1];
	return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` || "~" : cwd;
};

const statsArgumentsFromText = (text: string): { readonly days: number; readonly repoFilter: string } => {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const dayWord = words.find((word) => /^\d+$/.test(word));
	return {
		days: dayWord ? Number(dayWord) : DEFAULT_DAYS,
		repoFilter: words.filter((word) => word !== dayWord).join(" "),
	};
};

const sessionsSince = async ({
	sessionsRoot,
	sinceMs,
	repoFilter,
}: {
	readonly sessionsRoot: string;
	readonly sinceMs: number;
	readonly repoFilter: string;
}): Promise<ReadonlyArray<SessionUsageInput>> => {
	const sessions: Array<SessionUsageInput> = [];
	for (const sessionDir of await readdir(sessionsRoot)) {
		const sessionDirPath = join(sessionsRoot, sessionDir);
		let files: Array<string>;
		try {
			files = await readdir(sessionDirPath);
		} catch {
			continue;
		}
		for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
			const filePath = join(sessionDirPath, file);
			if ((await stat(filePath)).mtimeMs < sinceMs) continue;
			const lines = (await readFile(filePath, "utf8")).split("\n");
			let cwd = "";
			try {
				cwd = JSON.parse(lines[0] ?? "{}").cwd ?? "";
			} catch {
				cwd = "";
			}
			const repo = repoFromCwd(cwd);
			if (repoFilter && !repo.includes(repoFilter)) continue;
			sessions.push({ sessionId: filePath, repo, lines });
		}
	}
	return sessions;
};

const cell = (value: string | number, width: number): string => String(value).padStart(width);

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer<SkillStatsReport>(ENTRY_TYPE, (entry, { expanded }, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		const report = entry.data;
		if (!report) return box;
		const scope = report.repoFilter ? ` in ${report.repoFilter}` : "";
		box.addChild(
			new Text(
				theme.bold(`Skill use, last ${report.days} days${scope}`) +
					theme.fg("dim", ` · ${report.sessionCount} sessions`),
				0,
				0,
			),
		);
		const nameWidth = Math.max(5, ...report.rows.map((row) => row.skill.length));
		box.addChild(
			new Text(
				theme.fg(
					"dim",
					`${"skill".padEnd(nameWidth)} ${cell("invoked", 7)} ${cell("read", 5)} ${cell("refs", 5)} ${cell("sessions", 8)}  repos`,
				),
				0,
				0,
			),
		);
		for (const row of report.rows) {
			const repos = (expanded ? row.repos : row.repos.slice(0, TOP_REPOS_SHOWN))
				.map(([repo, count]) => `${repo} ${count}`)
				.join(", ");
			box.addChild(
				new Text(
					`${row.skill.padEnd(nameWidth)} ${cell(row.invocations, 7)} ${cell(row.skillFileReads, 5)} ${cell(row.referenceReads, 5)} ${cell(row.sessions, 8)}  ${theme.fg("dim", repos)}`,
					0,
					0,
				),
			);
		}
		if (report.neverUsed.length > 0)
			box.addChild(new Text(theme.fg("warning", `Never used: ${report.neverUsed.join(", ")}`), 0, 0));
		return box;
	});

	pi.registerCommand("skill-stats", {
		description: "Skill invocations and reads per skill and repo: /skill-stats [days] [repo]",
		handler: async (args) => {
			const { days, repoFilter } = statsArgumentsFromText(args);
			const sessionsRoot = join(getAgentDir(), "sessions");
			const sessions = await sessionsSince({ sessionsRoot, sinceMs: Date.now() - days * 86_400_000, repoFilter });
			const usageBySkill = skillUsageFromSessions(sessions);
			const rows = [...usageBySkill.values()]
				.map((usage) => ({
					skill: usage.skill,
					invocations: usage.invocations,
					skillFileReads: usage.skillFileReads,
					referenceReads: usage.referenceReads,
					sessions: usage.sessions.size,
					repos: [...usage.repos].sort((left, right) => right[1] - left[1]),
				}))
				.sort((left, right) => right.sessions - left.sessions || left.skill.localeCompare(right.skill));
			const availableSkills = pi
				.getCommands()
				.filter((command) => command.source === "skill")
				.map((command) => command.name.replace(/^skill:/, "").replace(/:\d+$/, ""));
			const neverUsed = [...new Set(availableSkills)].filter((skill) => !usageBySkill.has(skill)).sort();
			pi.appendEntry<SkillStatsReport>(ENTRY_TYPE, {
				days,
				repoFilter,
				sessionCount: sessions.length,
				rows,
				neverUsed,
			});
		},
	});
}
