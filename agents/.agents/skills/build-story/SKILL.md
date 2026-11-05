---
name: build-story
description: Build an approved story in slices agreed with the person: one builder sub-agent per slice as stacked PRs, one reviewer over the whole stack at the end, questions and results relayed through the Inbox. Invoke as /skill:build-story <story path or name> [rows]. Needs herdr.
disable-model-invocation: true
---

# Build a story

You are the orchestrator: you agree the slices with the person, start a builder per slice, answer what the docs answer, relay the rest to the Inbox, and put one reviewer on the finished stack. You write no feature code. The story came out of exploring with the person; it is the starting point, not a contract: when the person says to drop or change something, change the story (its Linear document and any local copy) and the affected slice at once, without asking whether to.

Read first: `~/.agents/skills/effect-ddd/SKILL.md` (Delivery), `~/.agents/skills/herdr/SKILL.md`, the repository's `AGENTS.md`, the story, and the code it changes.

## 1. Slices, agreed before any code

Propose the slices in the chat (the Inbox when the person is away): a table of slice, story rows and rules, base branch, rough size. A slice is logically complete: a reviewer reads it as one behavior from end to end (enable and disable together; a handler together with the event it reacts to when both are small), and it fits one review sitting. Slices stack: each branches from the one before; slices that don't touch each other branch from the same base and run in parallel.

Build nothing until the person agrees to the slices. Complete when they did, and the Inbox thread `<story> build` has one `steps` entry per slice.

## 2. Build

Per slice: `worktree_create({ cwd: <main checkout>, branch: "feat/<story>-<slice>", base, startPi: false })`; wait for the ship plugin's setup when the project has one; `subagent_launch({ name: "build-<slice>", cwd, prompt })` with the brief below. Start every slice whose base exists; a stacked slice starts once the slice below it has pushed.

On a builder's question: answer it when the story, a skill it loaded, or a repo doc answers it, quoting the line, and note the answer in the thread. Carry only what none of them answers to the person as a `:::question`, with options and a recommendation, and keep the other slices running. An answer that changes a slice below the asker goes to that slice first; then the slices above rebase.

Report in the thread when a slice opens its PR, one line.

## 3. Review at the end

When every slice has its PR, launch one reviewer over the whole stack (`model: "anthropic/claude-sonnet-5"`, brief below), so it judges the story against the code as a whole. Each finding names its PR. Then:

- Blocking and Should fix findings: one fix builder per affected slice, all at once. Check the fixes yourself against the report; a second reviewer only when a fix rewrites a slice.
- **Story** findings and design questions: the person's, as `:::question` blocks.
- Hand the stack to the person: one guided review per PR (`plannotator_inbox get_guide_brief`, then `submit_guide` on the PR's own diff against its base), and the merge order. Card `in_review`.

Complete when every PR has a guided review in the Inbox and no finding is unanswered.

## 4. Merge

The person merges. After each merge, rebase the slices above onto the new base, resolve what a rebase resolves, run `pnpm check` (or the host's check), and push. A conflict that needs a decision goes to the person.

## Builder brief

```text
Build one slice of the story at <story path or Linear document>: rows <rows>, rules <n, m>.

Read first, completely: ~/.agents/skills/effect-ddd/SKILL.md and the reference file for every layer you touch; ~/.agents/skills/code-style/SKILL.md; AGENTS.md; the story; the module the story names as its model.

Your branch starts from <base>; open the PR with `--base <base>` and say what it is stacked on. Build exactly this slice. Done when every example row of its rules has a test named as the row with the row's values; nothing in the PR lacks a reader in the PR; the host's checks and the touched tests pass. Commit (~/.agents/skills/commit/SKILL.md) and open the PR (~/.agents/skills/pr/SKILL.md); the body names the rows and lists the example rows it makes true.

A question none of these files answers: stop and ask it in your reply, with options and a recommendation. Reply with the PR URL and the test names.
```

## Reviewer brief

```text
Review the stack <PR URLs, bottom first> for an orchestrator, as one change: the story is <story>. Read ~/.agents/skills/review/SKILL.md completely and follow it over the combined diff (<main>...<top branch>), then name the PR for each finding. Decided by the person, not findings: <list>. Reply as its "Reporting to an orchestrator" section says. Edit nothing, post nothing.
```

## Rules

- Nothing merges without the person. Finished agents' panes stay open.
- Model and thinking: the reviewer runs on Sonnet; everything else on the person's defaults unless they say otherwise.
- Stop and report in the thread when a fix fails the checks twice, a builder asks the same question twice, or a slice no longer fits the agreed cut.
