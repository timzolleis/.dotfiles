---
name: engineering
description: Engineering principles for debugging, verifying work, designing or refactoring code, migrations, retries and concurrency, judging tests, and reporting measured numbers. Use before fixing a bug, declaring work done, shaping a module or API, or reporting a perf result.
---

# Engineering

Index of principle skills. Read the matching file completely before applying it, then name the principle that changed a decision. In Effect code, `effect-ddd` wins on conflict.

| Situation | Read |
|---|---|
| Debugging a symptom | [fix-root-causes](~/.agents/skills/principle-fix-root-causes/SKILL.md) |
| Two fixes on one assumption failed | [attack-the-premise](~/.agents/skills/principle-attack-the-premise/SKILL.md) |
| About to declare done | [prove-it-works](~/.agents/skills/principle-prove-it-works/SKILL.md) |
| Non-trivial edits, migration, analysis, or check | [build-the-lever](~/.agents/skills/principle-build-the-lever/SKILL.md) |
| Multi-step work, stacking commits or PRs | [sequence-verifiable-units](~/.agents/skills/principle-sequence-verifiable-units/SKILL.md) |
| Reporting or acting on a measured number | [explain-the-number](~/.agents/skills/principle-explain-the-number/SKILL.md); perf numbers also [benchmark-checklist](~/.agents/skills/benchmark-checklist/SKILL.md) |
| Stateful logic, growing branches, repeated shape assumptions | [model-the-domain](~/.agents/skills/principle-model-the-domain/SKILL.md) |
| Choosing core types, sequencing scaffold vs feature | [foundational-thinking](~/.agents/skills/principle-foundational-thinking/SKILL.md) |
| Code is hard to trace; adding a layer or state | [minimize-reader-load](~/.agents/skills/principle-minimize-reader-load/SKILL.md) |
| New requirement into an existing design | [redesign-from-first-principles](~/.agents/skills/principle-redesign-from-first-principles/SKILL.md) |
| Sequencing an addition, refactor, or rewrite | [subtract-before-you-add](~/.agents/skills/principle-subtract-before-you-add/SKILL.md), [laziness-protocol](~/.agents/skills/principle-laziness-protocol/SKILL.md) |
| New internal API while old callers exist | [migrate-callers-then-delete-legacy-apis](~/.agents/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) |
| Planned rewrite with phase boundaries | [outcome-oriented-execution](~/.agents/skills/principle-outcome-oriented-execution/SKILL.md) |
| Commands, jobs, or loops that crash and retry | [make-operations-idempotent](~/.agents/skills/principle-make-operations-idempotent/SKILL.md) |
| Concurrent writers to one file, key, branch, or object | [separate-before-serializing-shared-state](~/.agents/skills/principle-separate-before-serializing-shared-state/SKILL.md) |
| Writing, changing, or keeping a test | [test-behavior-not-implementation](~/.agents/skills/principle-test-behavior-not-implementation/SKILL.md); Effect code: [effect-ddd testing](~/.agents/skills/effect-ddd/testing.md) |
| Same instruction or correction a second time | [encode-lessons-in-structure](~/.agents/skills/principle-encode-lessons-in-structure/SKILL.md) |

User-invoked commands, never auto-run: `/skill:correct` (make a repeated agent mistake impossible), `/skill:blast-radius` (what a change breaks elsewhere), `/skill:sharpen`, `/skill:bro`.
