---
name: review
description: Review a PR, diff, or feature against its requirement, code-style and, in Effect code, effect-ddd. Runs the host's checks first, then reads what checks can't catch. Works as a reviewer sub-agent reporting to an orchestrator.
disable-model-invocation: true
---

# Review

1. **Resolve the target**: a PR number or URL → `gh pr view` for the body and `gh pr diff`; nothing or "diff" → uncommitted changes, staged and unstaged, plus new files; a path or feature name → its files. Say what you reviewed. Complete when every changed file is in the list.
2. **Run the checks before reading**: the repository's `AGENTS.md` names them (`pnpm check`, the test command for the touched modules). A failing check is the first finding, verbatim, and the review stops there: nothing else is worth reading until it passes. Report only what the checks can't catch.
3. **Find the requirement**: the behavior the PR body or its linked issue says the change builds. A change that states none has no requirement, which is a finding. Read `~/.agents/skills/code-style/SKILL.md` completely, and its `testing.md` when the target touches tests. In Effect code, read `~/.agents/skills/effect-ddd/SKILL.md` completely and the reference for every layer the target touches: `domain/` → `model.md`, `rules.md`, `access.md`; the repository → `repository.md`; `application/` → `use-cases.md`; `view/` → `views.md`; `http/` → `http.md`; tests → `testing.md`. Read the repository's `AGENTS.md`. Complete when you can name the requirement behind each changed behavior, or the change has none.
4. **Check the slice** (effect-ddd, [Delivery](~/.agents/skills/effect-ddd/SKILL.md#delivery)):
   - Every changed behavior has a test, and the stated behavior and its code agree: read what the PR says, then the function. This is the one check nothing automates.
   - Nothing in the PR lacks a reader in the PR: an actor flag no rule reads, a find no use case calls, an error nothing returns, a rule list of one, a `Result` on a transition without a rule, a visibility with one reader ([exists once](~/.agents/skills/effect-ddd/SKILL.md#conventions)).
   - Nothing outside the slice changed: a use-case PR touches no repository, no other use case's service, no `lib/`. When it must, the body says why.
   - Events carry what subscribers need and nothing for persistence (`previous…` fields for guards).
5. **Follow each changed path end to end** (route → actor → use case → transition → evolve → save → response), reading enough surrounding code to understand the behavior that changed. Check it against the requirement, code-style (comments, names, functions and helpers, the red flags, [testing](../code-style/testing.md)), the repository's `AGENTS.md`, and, in Effect code, effect-ddd's deciding rules, conventions, naming, and [testing](~/.agents/skills/effect-ddd/testing.md).
6. **Then ask of the whole change**:
   - Can it be simpler? Which rare edge cases can it reasonably ignore?
   - Does it add hardening, validation, or cases the requirement doesn't call for?
   - Are the types as strict as they can be? Is everything that can be typed typed, without a loosen-then-recheck?
   - Does it pay avoidable performance costs: copies of arrays or objects, nested loops, the same database read twice?
   - Does it work around a bad design or an earlier decision? Would a redesign give a better result?
7. **Report**, most severe first, grouped as **Blocking**, **Should fix**, **Nit**. One line each: `file:line` and the symbol, what is wrong, the rule or requirement it breaks, the fix. Report only what you can point to in the code. A finding that recurs across PRs ends with the check that would catch it (`lint: …`, `type: …`): a review comment written twice is a check not written.

## Reporting to an orchestrator

When another agent started you, your reply is the review and it is capped: first line the verdict, `approve` or `changes requested`, then the Blocking findings, one line each, then the path of the full report written to `/tmp/review-<branch>.md`. Nothing else in the reply. A design finding (step 6, last question) that reaches past this slice is not a change request on the PR: it goes in the report under **Design**, with the options and a recommendation, and the orchestrator carries it to the user. Edit nothing, approve nothing on GitHub, post no comment: the orchestrator decides what reaches the builder and the PR.

Be bold. When throwing away much of the code or a different approach would give a better result, say so as a finding, with what it replaces. Edit nothing unless fixes are requested. Complete when the checks ran, every touched part was checked against its requirement and its reference, the step 6 questions were asked of the whole change, and every finding has a location and a rule.
