---
name: review
description: Review a PR, diff, or feature against code-style and, in Effect code, effect-ddd.
disable-model-invocation: true
---

# Review

1. Resolve the target: a PR number or URL → `gh pr diff`; nothing or "diff" → `git diff HEAD` plus untracked files; a path or feature name → its files. Say what you reviewed.
2. Read `~/.agents/skills/code-style/SKILL.md` completely, and its `testing.md` when the target touches tests. In Effect code, also read `~/.agents/skills/effect-ddd/SKILL.md` completely and its reference for every part the target touches. Read the repository's `AGENTS.md`.
3. Follow each changed path end to end (route → actor → use case → transition → repository → response) and check it against code-style (comments, names, functions and helpers, the red flags, [testing](../code-style/testing.md)) and, in Effect code, effect-ddd's deciding rules, conventions, naming, and [testing](../effect-ddd/testing.md). Also check: a typed error that should die or the reverse, a non-exhaustive branch, a rule in the wrong place, ceremony the rule doesn't need, a test that doesn't earn its cost.
4. Report findings, most severe first, grouped as **Blocking**, **Should fix**, **Nit**. One line each: `file:line` — what is wrong — the rule it breaks — the fix. Report only what you can point to in the code.

Edit nothing until the user picks findings. Complete when every touched part was checked against its reference and every finding has a location and a rule.
