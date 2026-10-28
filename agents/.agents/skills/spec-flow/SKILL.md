---
name: spec-flow
description: "Orchestrate domain work through herdr sub-agents: spec, approval in the Plannotator Inbox, build, review."
disable-model-invocation: true
---

# Spec flow

You are the orchestrator. Sub-agents write, build and review. Only you talk to the person, and only through the Plannotator Inbox (`plannotator_inbox`). They approve specs and see finished PRs; everything in between runs without them.

Read the `herdr` and `ship` skills before the first launch.

## Session setup

- Start the orchestrator as `PI_CACHE_RETENTION=long pi`, so an Inbox reply within 1 h wakes you without rewriting your cache. Sub-agents keep the default 5 min.
- The Inbox tool must be on for you (`inboxTool.pi` in `~/.plannotator/config.json`). Sub-agents get `PLANNOTATOR_INBOX_TOOL=0` from `scripts/launch`, so they never message the person.
- Project notes: one file of project facts every brief adds (goal, extra spec sections, constraints). For elternportal: `/Users/tim/code/elternportal/plans/spec-flow.md`.

## Roles

| Role | Model / thinking | Brief | Starts from | Ends with |
|---|---|---|---|---|
| spec | `anthropic/claude-opus-5-5` medium | [briefs/spec.md](briefs/spec.md) | the legacy code | story + spec committed, final reply |
| revise | `anthropic/claude-opus-5-5` low | [briefs/revise.md](briefs/revise.md) | spec + the person's annotations | revised docs committed |
| build | `anthropic/claude-sonnet-5-5` medium; Opus medium for a complex module | [briefs/build.md](briefs/build.md) | the approved spec | PR open with evidence |
| review | `anthropic/claude-sonnet-5-5` medium | [briefs/review.md](briefs/review.md) | spec + PR diff | findings report |

Every phase gets a **fresh** agent. The committed docs are the handoff, so no agent carries another phase's exploration context. An agent that ends gets closed (`herdr pane close`). A waiting agent pays a cache rewrite of its whole context when it wakes.

## Steps

1. **Units.** Split the work into units (one module or area each). Create one workspace per unit: `ship create <project> <branch> --base origin/main --no-editor`.
   Fill each brief with `scripts/fill <brief> /tmp/spec-flow/<unit>-<role>.md UNIT=… ISSUE=… DIR=… BRANCH=… SPEC_DIR=… NOTES=… LEGACY=…` (it fails on any placeholder left; `revise` needs `FEEDBACK`, `review` needs `PR`).
   Complete when every unit has a workspace, an issue and a filled spec brief.
2. **Spec.** `scripts/launch spec-<unit> <dir> anthropic/claude-opus-5-5 medium <brief>`. Wait with `herdr agent wait spec-<unit> --until done --timeout 3600000`. Never poll with `agent read` loops.
   Complete when the docs are committed on the branch and the pane is closed.
3. **Approval.** Send the docs with the [spec message](#inbox-messages). End your turn; the reply wakes you.
   - **Changes:** save the reply (answers + annotations) to `/tmp/spec-flow/<unit>-feedback-<n>.md`, launch a reviser, then send the revised docs with `reply_to` = the reply id and `supersedes` = the old question.
   - **Approve:** go to step 4.
   Complete when the reply's answer is "Approve, build it".
4. **Build.** Launch a builder with the build brief.
   Complete when it reports a PR URL with `pnpm check` green and evidence attached.
5. **Review.** Launch a reviewer on the PR. Prompt the builder (or a fresh builder, if it is closed) with the Blocking and Should fix findings. Repeat until the reviewer reports neither.
   Complete when the last review has no Blocking or Should fix.
6. **Hand over.** Send the [PR message](#inbox-messages). Close the build and review panes. After the merge, run `ship down` on the workspace.

Run several units side by side, with spec agents running ahead, so approved specs are always waiting for a builder and new specs for the person.

## Inbox messages

Spec (one thread per unit, `thread: "<unit> spec"`, `project_path` = the workspace, docs in `attachments`):

```md
<2–3 lines: use cases, key decisions, open-point count with the important ones named>

Annotate the files and answer the open points inline.

:::question
Approve the <unit> spec?

- [ ] Approve, build it
- [ ] Changes needed (see my annotations)

Recommended: Approve, build it
Holds up: <unit> build
Stakes: <what the build commits to, one sentence>
:::
```

PR (same thread, `reply_to` the approval): the PR URL, use cases shipped, legacy deleted, review rounds, open points, and shots in `attachments`. Ask a question only when a decision is left.

## Token rules

- Always pass `--model` and `--thinking`. Never switch a running agent's model, because that drops its cache.
- Briefs point to files (skills, specs, AGENTS.md) instead of pasting them.
- Read only the tail of an agent's output (`herdr agent read <name> | tail -40`).
