---
name: review
description: Review a PR, diff, or feature against its requirements, code-style and, in Effect code, effect-ddd.
disable-model-invocation: true
---

# Review

1. Resolve the target: a PR number or URL → `gh pr diff`; nothing or "diff" → uncommitted changes, staged and unstaged, plus new files; a path or feature name → its files. Say what you reviewed. Complete when every changed file is in the list.
2. Find the requirements: the spec, story, issue, or brief the change implements. Read `~/.agents/skills/code-style/SKILL.md` completely, and its `testing.md` when the target touches tests. In Effect code, also read `~/.agents/skills/effect-ddd/SKILL.md` completely and its reference for every part the target touches. Read the repository's `AGENTS.md`. Complete when you can name the requirement behind each changed behavior, or the change has none.
3. Follow each changed path end to end (route → actor → use case → transition → repository → response), reading enough surrounding code to understand the behavior that changed. Check it against the requirements, code-style (comments, names, functions and helpers, the red flags, [testing](../code-style/testing.md)), the repository's `AGENTS.md` for code, tests, database, and UI, and, in Effect code, effect-ddd's deciding rules, conventions, naming, and [testing](../effect-ddd/testing.md).
4. Then ask of the whole change:
   - Can it be simpler? Which rare edge cases can it reasonably ignore?
   - Does it add hardening, validation, or cases the requirements don't call for?
   - Are the types as strict as they can be? Is everything that can be typed typed, without a loosen-then-recheck?
   - Does it pay avoidable performance costs: copies of arrays or objects, nested loops, the same database read twice?
   - Does it work around a bad design or an earlier decision? Would a redesign or refactor give a better result?
5. Report findings, most severe first, grouped as **Blocking**, **Should fix**, **Nit**. One line each: `file:line` and the symbol, what is wrong, the rule or requirement it breaks, the fix. Report only what you can point to in the code.

Be bold. When throwing away much of the code, a large refactor, or a different approach would give a better result, say so as a finding, with what it replaces. The user or the coordinator decides; your job is to show the better option.

Edit nothing unless fixes are requested. Complete when every touched part was checked against its requirement and its reference, the step 4 questions were asked of the whole change, and every finding has a location and a rule.
