---
name: skill-retro
description: Measure how a skill performed over a period from code, PR reviews, and session logs, then propose what to cut, lint, or rewrite. Invoke as /skill:skill-retro <skill> [since]; default effect-ddd, 7 days.
disable-model-invocation: true
---

# Skill retro

A skill earns its lines by preventing corrections. This measures which lines did, which didn't, and which were never read. It edits nothing: the report goes to the Inbox with the proposals as questions.

Arguments: the skill's name (default `effect-ddd`) and a period (`7d`, `2w`, or a date; default 7 days). The skill's files are in `~/.agents/skills/<skill>/`; the rules are its numbered deciding rules and its convention bullets, one per line.

## 1. Evidence

Gather all four before judging anything. Each item is kept with its source (commit, PR comment URL, session file and line), so every claim in the report cites one.

**Code**: in the current repository (and any other whose sessions read the skill), `git log --since=<period> --name-only`. For each module the skill shaped: files and lines per use case, `lib/` helpers added, rule lists of length one, `Effect.die` and casts, `_tag ===`, `Effect.fail(new`, a repository file changed by a use case PR, events with `previous` fields. Each count is a rule of the skill, kept or broken.

**Reviews**: `gh pr list --state merged --search "merged:>=<date>"`, then `gh api repos/{owner}/{repo}/pulls/<n>/comments` and `reviews` for each. Classify every comment: *stated* (the skill says it, the code broke it: the skill failed to prevent), *missing* (a rule the skill lacks), *noise* (style, not the skill's job).

**Sessions**: `~/.pi/agent/sessions/<cwd-encoded>/*.jsonl` with a timestamp in the period; a session counts when a `read` tool call targeted a file of the skill. In those, each user message that corrects the agent: short, after an agent action, with "no", "don't", "why", "we said", "not", a question mark, or a rule restated. For each: which rule of the skill it restates, or none. Also count, per skill file, how often it was read.

**Stories**: the host's story check (`pnpm stories check` or the like); story length; example rows per rule; use case rows without `Code`.

## 2. Judgment

For every rule of the skill, one of: **followed** (exercised, no correction, no review comment), **broken** (a correction or a *stated* comment cites it; count them), **never exercised** (no code in the period could have broken it), **unclear** (two agents read it differently: a correction argues about its meaning).

For every file of the skill: reads in the period, and the rules in it that were exercised.

## 3. Proposals

At most three, ranked by corrections saved, each one line with its cost:

- a rule broken twice or more → a lint, a type, a test, or a layout that makes it structural; name the check
- a rule *unclear* → the rewritten sentence, verbatim
- a *missing* correction twice or more → the sentence to add, verbatim, and the file
- a file read zero times, or a rule never exercised in two retros → cut or merge; name where its exercised lines go
- an example whose weight the code copied (flags, states, helpers nothing reads) → the lighter example to add, in 15 lines or fewer

Never propose prose for a rule a check can carry. Never propose adding without naming what to cut.

## 4. Report

One Inbox message in the thread `<skill> retro`, 40 to 80 lines:

1. Numbers: period, repositories, use cases built, lines and files per use case, sessions that read the skill, corrections, review comments by class.
2. Rules broken, most first, each with its citations.
3. Rules never exercised; files never read.
4. Corrections the skill didn't cover, verbatim.
5. The proposals, each as a `:::question` block with the cost and `Recommended:`.

What the report does not contain: praise, a summary of the skill, a proposal without a citation, or an edit. The user decides; the next session edits.
