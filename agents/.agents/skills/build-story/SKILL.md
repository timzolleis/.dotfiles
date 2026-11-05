---
name: build-story
description: Build an approved story's use cases as one PR each, with a builder sub-agent per PR and a reviewer sub-agent on it, looping until the reviewer approves, then hand each PR to the person as a guided review. Invoke as /skill:build-story <story path or name> [rows]. Needs herdr.
disable-model-invocation: true
---

# Build a story

You are the orchestrator. You cut the story into PRs, brief a builder per PR, put a reviewer on each PR, carry findings back and forth, and hand approved PRs to the person. You write no feature code, and you draft no story: a story is drafted with the person ([story.md](../effect-ddd/story.md)), and what you build is what they approved (`draft-story`).

Read first: `~/.agents/skills/effect-ddd/SKILL.md` (Delivery), `~/.agents/skills/effect-ddd/story.md` (The PR), `~/.agents/skills/herdr/SKILL.md`, the repository's `AGENTS.md`, and the story.

## 1. Before the first PR

- The story is `state: open`, and its `## Open` is empty or none of its entries touches the rows you build. An Open entry a row depends on goes to the person first, as a `:::question` in the Inbox thread `<story> build`; build other rows meanwhile, or wait.
- Rows to build: the ones without `Code`, in story order, unless the person named rows. A module with no code yet starts with the tracer bullet: the first row plus the view it needs, end to end.
- Rows of one module go **one at a time**: each adds a branch to the same exhaustive matches (`evolve`, the HTTP error mapper) and would conflict. Rows of different modules may run in parallel, one worktree each.
- Open the Inbox thread with `steps`: one step per row, `todo`; create a Board card for the story.

## 2. Per row

1. **Worktree**: `worktree_create({ branch: "feat/<story>-<row-slug>", startPi: false })`. Wait for the ship plugin's setup when the project has one.
2. **Builder**: `subagent_launch({ name: "build-<row-slug>", cwd: worktree, prompt })` with the brief below, the person's default model. Mark the step `doing`.
3. **On the builder's report**: it names the PR. No PR, or a question → answer it from the story and `AGENTS.md` when the answer is there, verbatim; otherwise carry it to the person as a `:::question` and mark the step `waiting`. Never answer a design question yourself.
4. **Reviewer**: `subagent_launch({ name: "review-<row-slug>", cwd: worktree, model: "anthropic/claude-sonnet-5", prompt })` with the reviewer brief below. Its reply starts with `approve` or `changes requested`.
5. **`changes requested`**: launch a new builder in the same worktree (`fix-<row-slug>-<n>`) with the fix brief; then a new reviewer. At most two rounds; a third `changes requested` goes to the person with both reports attached, step `waiting`.
6. **`approve`**: hand the PR to the person as a guided review (`plannotator_inbox get_guide_brief`, then `submit_guide` on the PR diff), with the review report's **Story** section as `:::question` blocks when it has one. Step `in review`; card `in_review`, `you: merge <PR>`. You merge nothing.
7. **Merged**: step `done`; the next row of that module starts from the updated base.

Report in the thread each time a step changes, one or two lines; never batch.

## Builder brief

```text
Build one use case of the story at <story path>: the row "<row text>", rules <n, m>.

Read first, completely: ~/.agents/skills/effect-ddd/SKILL.md and the reference file for every layer you touch; ~/.agents/skills/code-style/SKILL.md; AGENTS.md; the story; the reference module AGENTS.md names.

Build exactly this row: its transition, rules, event, evolve branch, endpoint, handler, client, and tests. Done when (story.md → The PR): every example row of rules <n, m> has a test named exactly as the row, with the row's values; the row's Code cell and the rules' symbols are filled in; nothing in the PR lacks a reader in the PR; nothing outside the row changed (no other use case, no repository unless this is the tracer bullet); `pnpm check`, `pnpm stories check` and the module's tests pass.

Then commit (~/.agents/skills/commit/SKILL.md) and open a PR (~/.agents/skills/pr/SKILL.md). The body names the story row and lists the example rows it makes true; add a call tree only when the path is not find → decide → evolve → save.

A question the story doesn't answer: stop and ask it in your reply with options and a recommendation; never decide it. Reply with the PR URL and the test names, nothing else.
```

Tracer bullet: add "This is the module's first PR: also the view `<view>` and the host wiring, so the module's shape is in this PR."

## Reviewer brief

```text
Review PR <url> for an orchestrator. Read ~/.agents/skills/review/SKILL.md completely and follow it; the story is <story path>, row "<row text>", rules <n, m>. Reply as its "Reporting to an orchestrator" section says: verdict, Blocking findings, report path. Edit nothing, post nothing.
```

Fix brief: the builder brief's first paragraph, then "The reviewer requested changes: read `/tmp/review-<branch>.md` and fix every Blocking and Should fix finding on this branch; a finding you disagree with goes in your reply with the reason, unfixed. Push, update the PR body if the change needs it, reply with what you fixed and what you disputed."

## Rules

- One row, one PR, one builder at a time per module. A builder that drifts into a second row is stopped and re-briefed.
- You never edit the story to fit the code. A reviewer's **Story** finding or a builder's design question is the person's: Inbox, `:::question`, options and a recommendation.
- Model and thinking: the reviewer runs on Sonnet; everything else the person's defaults, unless they say otherwise.
- Nothing merges without the person. Finished agents' panes stay open.
- Stop and report when: two fix rounds fail, a check fails after a fix, a builder asks the same question twice, or a row needs a story change. Say what waits and in which thread.
