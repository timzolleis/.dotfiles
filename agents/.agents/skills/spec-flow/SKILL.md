---
name: spec-flow
description: "Orchestrate domain work through herdr sub-agents: spec, approval in the Plannotator Inbox, build, review, guided review."
disable-model-invocation: true
---

# Spec flow

You are the orchestrator. Sub-agents write, build and review. Only you talk to the person, and only through the Plannotator Inbox (`plannotator_inbox`). They approve specs and see finished PRs; everything in between runs without them.

Read the `ship` skill before the first workspace. Read the `herdr` skill only when a sub-agent misbehaves.

## Sub-agents

Launch from codemode with `tools.subagent_launch({ name, cwd, model, thinking, briefFile })`. It returns at once. When the agent settles, a `Sub-agent <name> finished` message starts your turn with its final reply, cost, shot runs and images read, and its pane is already closed (a failed agent's pane stays open). Never wait for, poll or read an agent's screen. Launch several in one script with `Promise.all`. `subagent_status` lists them; `subagent_stop` closes one early.

## Session setup

- Start the orchestrator as `PI_CACHE_RETENTION=long pi`, so an Inbox reply within 1 h wakes you without rewriting your cache. Sub-agents keep the default 5 min.
- The Inbox tool must be on for you (`inboxTool.pi` in `~/.plannotator/config.json`). Sub-agents get the Inbox and agent tools off from `subagent_launch`, so they never message the person.
- Project notes: one file of project facts every brief adds (goal, extra spec sections, constraints). For elternportal: `/Users/tim/code/elternportal/plans/spec-flow.md`.

## Roles

| Role | Model / thinking | Brief | Starts from | Ends with |
|---|---|---|---|---|
| spec | `anthropic/claude-opus-5-5` medium | [briefs/spec.md](briefs/spec.md) | the legacy code | story + spec committed, final reply |
| revise | `anthropic/claude-opus-5-5` low | [briefs/revise.md](briefs/revise.md) | spec + the person's annotations | revised docs committed |
| build | `anthropic/claude-sonnet-5-5` medium; Opus medium for a complex module | [briefs/build.md](briefs/build.md) | the approved spec | PR open with evidence |
| review | `anthropic/claude-sonnet-5-5` medium | [briefs/review.md](briefs/review.md) | spec + PR diff | findings report |
| fix | `anthropic/claude-sonnet-5-5` medium | [briefs/fix.md](briefs/fix.md) | spec + findings | fixes pushed |
| guide | `anthropic/claude-sonnet-5-5` low | [briefs/guide.md](briefs/guide.md) | final PR diff | guide JSON + patch files |

Every phase gets a **fresh** agent. The committed docs are the handoff, so no agent carries another phase's exploration context. A waiting agent pays a cache rewrite of its whole context when it wakes.

## Steps

1. **Units.** Split the work into units (one module or area each). Create one workspace per unit: `ship create <project> <branch> --base origin/main --no-editor`.
   Fill each brief with `scripts/fill <brief> /tmp/spec-flow/<unit>-<role>.md UNIT=… ISSUE=… DIR=… BRANCH=… SPEC_DIR=… NOTES=… LEGACY=…` (it fails on any placeholder left; `revise` needs `FEEDBACK`, `review` needs `PR`, `guide` needs `PR`, `GUIDE_OUT=/tmp/spec-flow/<unit>-guide.json`, `PATCH_OUT=/tmp/spec-flow/<unit>.patch`).
   Complete when every unit has a workspace, an issue and a filled spec brief.
2. **Spec.** Launch `spec-<unit>` with the spec brief. End your turn.
   Complete when its finished message names the committed docs.
3. **Approval.** Send the docs with the [spec message](#inbox-messages). End your turn; the reply wakes you.
   - **Changes:** save the reply (answers + annotations) to `/tmp/spec-flow/<unit>-feedback-<n>.md`, launch a reviser, then send the revised docs with `reply_to` = the reply id and `supersedes` = the old question.
   - **Approve:** go to step 4.
   Complete when the reply's answer is "Approve, build it".
4. **Build.** Launch a builder with the build brief.
   If the builder changed the spec, send the spec diff to the same Inbox thread with an accept question before step 5.
   Complete when it reports a PR URL with `pnpm check` green and evidence attached.
5. **Review.** Launch a reviewer on the PR, then a fixer (`FINDINGS` = the Blocking and Should fix lines, plus one-line Nits). At most two review rounds: Should fix left after the second goes into the PR message as an open point; Blocking left goes to the person as a question.
   Complete when the last review has no Blocking or Should fix, or two rounds ran.
6. **Guide.** Launch `guide-<unit>` with the guide brief. It needs `/tmp/spec-flow/guide-brief.json`; write it once per session, in codemode, so it never enters your context:
   ```js
   const t = await tools.plannotator_inbox({ action: "get_guide_brief" });
   await tools.write({ path: "/tmp/spec-flow/guide-brief.json", content: t.slice(t.indexOf("{")) });
   ```
   Complete when its finished message names both files.
7. **Hand over.** Send the [PR message](#inbox-messages), then the guided review as a reply in the same thread. Submit it from codemode, which reads the files so the patch never enters your context:
   ```js
   async function readAll(path) { // tools.read caps output; page through and drop its continuation notes
     let out = "", offset = 1;
     for (;;) {
       const t = await tools.read({ path, offset, limit: 500 });
       const m = t.match(/\n\n\[[^\]]*Use offset=(\d+) to continue\.\]$/);
       if (!m) return out + t;
       out += t.slice(0, m.index) + "\n";
       offset = Number(m[1]);
     }
   }
   return tools.plannotator_inbox({
     action: "submit_guide", reply_to: "<PR message id>", project_path: "<workspace>",
     body: "Guided review of <PR URL>",
     guide: JSON.parse(await readAll("/tmp/spec-flow/<unit>-guide.json")),
     patch: await readAll("/tmp/spec-flow/<unit>.patch"),
   });
   ```
   On `invalid_guide: …`, launch a fresh guide agent with the error appended to its brief.
   After the merge, run `ship down` on the workspace.

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

PR (same thread, `reply_to` the approval): the PR URL, use cases shipped, legacy deleted, review rounds, open points, and shots in `attachments`. Ask a question only when a decision is left. The guided review follows as its own reply (step 7); `submit_guide` takes no attachments.

## Token rules

- Always pass `--model` and `--thinking`. Never switch a running agent's model, because that drops its cache.
- Briefs point to files (skills, specs, AGENTS.md) instead of pasting them.
- Read the stats line of each finished message. When one role keeps costing more than its work needs (shot runs, images read, $), tighten its brief, not the agent mid-run.
