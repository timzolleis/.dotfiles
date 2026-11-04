---
name: code-style
description: How we write code in any repo and language. Comments, names, helpers, function signatures, tests, the red-flag check before handing over a diff, and which engineering principle to read when debugging, verifying, refactoring, migrating, retrying, running concurrent writers, or reporting a measured number. Use before writing, changing, or reviewing code or tests.
---

# Code style

The rules for code anywhere. Effect features add the `effect-ddd` skill on top; on conflict it wins.

## Around every change

1. Before writing code, name the data shape and the module and layer each piece lives in. Complete when every new type and function has a named home.
2. Before handing over a diff, check it for red flags and fix each one: a list kept in two places, two ways to do one task, a pass-through that only forwards, a second owner of the same state, knowledge restated outside the module that owns it, a type loosened and then checked again, a helper with one caller. Complete when none remains, or the reply names each one left and why.
3. When you make the same correction a second time, encode it as a lint, a type, or a test ([encode-lessons-in-structure](~/.agents/skills/principle-encode-lessons-in-structure/SKILL.md)) instead of writing more instructions.

## Comments

Code carries no comments, anywhere: rule comments ("rule 6", "(data source rule 2)") included. Comments already in a file are no license to add more. Say it instead with a descriptive name, a test for an edge case that needs explaining, a rule number in the test name, and the why and where in your reply.

## Names

A name is truthful and greppable: the name alone says what a thing is or does, without its arguments, its return type, or the surrounding code filling the gap, and a search for it finds only it.

- Name the subject: `findActiveAbsenceById`, `publishAbsenceEvent`. `findById`, `publish`, `execute` match thousands of lines.
- An action starts with its verb: `archiveAbsence`, `generateAbsenceId`.
- A translation names its output and its input, `<output>From<input>`: `absenceActorFromPermissions(…)`, `dateTimeUtcFromDate(date)`, `fingerprintIntentFromPosition(position)`. `mapTo`, `toHttpError`, `absenceFrom(row)` each leave one side to the arguments or the return type.
- A name ends in the thing it names, not in a preposition its argument completes. `residenceOf(child)` is `childResidence(child)`; `visibilityFor(reader)` is `absenceVisibilityFromReader(reader)`; `isDomainWithin(…)` is `isDomainWithinParentDomain(…)`. `Of` is the common slip.
- Variables say what they hold: `absenceBeforeUpdate`, `previousPeriod`, not `before`, `prev`, `data`, `result`, `tmp`.
- One thing keeps one name through every layer: `reasonWithSameName` in the find stays `reasonWithSameName` in the input, the rule, and its callback.
- Plain words in the domain's language that say what the thing is; no borrowed jargon (`Roster` for "the persons already signed up").
- Grep a new name before you use it: a name another module already uses is taken.
- Files are kebab-case (`absence-rule.ts`); identifiers are camelCase or PascalCase.

## Functions and helpers

- An expression with one caller stays inline. Extract it when a second caller appears, or when its name is a domain term a reader would look up. The ban on comments is not a reason to extract.
- A parameter never changes what a function returns: not its fields, its type, or its error channel. Two shapes are two functions (`getUser`, `getUserWithDetails`). Two operations behind a boolean are two functions (`replaceAllRows`, `applyRowChanges`).
- A function with more than one argument takes one object (`archiveAbsence({ absence, actor, now })`); a single argument stays positional.
- Behavior is named exports imported by name; no namespace imports.
- Across a boundary (request → command, port → database row, vendor type → adapter), name every field: `{ from: payload.from, to: payload.to }`, never `...payload`. A spread lets a field added on one side flow into the other unchecked. Spreads stay inside one layer.
- Build only what a current reader uses. A field, index, guard, variant, error, or wrapper for a consumer that doesn't exist yet lands with that consumer.
- Two places merge only when they are the same knowledge and change for the same reason. Look-alike code from different use cases stays apart; so does code that would only match through parameters and branches. The shared knowledge lives in the module that owns it, and the others import it. Readability beats KISS, KISS beats DRY.

## Tests

Before writing, changing, or keeping a test, read [testing.md](testing.md).

## Principles

Read the matching file completely before applying it, then name the principle that changed a decision.

| Situation | Read |
|---|---|
| Debugging a symptom | [fix-root-causes](~/.agents/skills/principle-fix-root-causes/SKILL.md) |
| Two fixes on one assumption failed | [attack-the-premise](~/.agents/skills/principle-attack-the-premise/SKILL.md) |
| About to declare done | [prove-it-works](~/.agents/skills/principle-prove-it-works/SKILL.md) |
| Non-trivial edits, migration, analysis, or check | [build-the-lever](~/.agents/skills/principle-build-the-lever/SKILL.md) |
| Multi-step work, stacking commits or PRs | [sequence-verifiable-units](~/.agents/skills/principle-sequence-verifiable-units/SKILL.md) |
| Reporting or acting on a measured number | [explain-the-number](~/.agents/skills/principle-explain-the-number/SKILL.md); perf numbers also [benchmark-checklist](~/.agents/skills/benchmark-checklist/SKILL.md) |
| Stateful logic, growing branches, repeated shape assumptions | [model-the-domain](~/.agents/skills/principle-model-the-domain/SKILL.md) |
| Designing types or a signature; a value loosened to `string`, `Record`, `unknown` or `as`, then checked again | [type-system-discipline](~/.agents/skills/principle-type-system-discipline/SKILL.md) |
| Placing validation, decoding, error handling, or a framework adapter | [boundary-discipline](~/.agents/skills/principle-boundary-discipline/SKILL.md) |
| Choosing core types, sequencing scaffold vs feature | [foundational-thinking](~/.agents/skills/principle-foundational-thinking/SKILL.md) |
| Code is hard to trace; adding a layer or state | [minimize-reader-load](~/.agents/skills/principle-minimize-reader-load/SKILL.md) |
| New requirement into an existing design | [redesign-from-first-principles](~/.agents/skills/principle-redesign-from-first-principles/SKILL.md) |
| Sequencing an addition, refactor, or rewrite | [subtract-before-you-add](~/.agents/skills/principle-subtract-before-you-add/SKILL.md), [laziness-protocol](~/.agents/skills/principle-laziness-protocol/SKILL.md) |
| New internal API while old callers exist | [migrate-callers-then-delete-legacy-apis](~/.agents/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) |
| Planned rewrite with phase boundaries | [outcome-oriented-execution](~/.agents/skills/principle-outcome-oriented-execution/SKILL.md) |
| Commands, jobs, or loops that crash and retry | [make-operations-idempotent](~/.agents/skills/principle-make-operations-idempotent/SKILL.md) |
| Concurrent writers to one file, key, branch, or object | [separate-before-serializing-shared-state](~/.agents/skills/principle-separate-before-serializing-shared-state/SKILL.md) |
| Writing, changing, or keeping a test | [test-behavior-not-implementation](~/.agents/skills/principle-test-behavior-not-implementation/SKILL.md) |

User-invoked commands, never auto-run: `/skill:correct` (make a repeated agent mistake impossible), `/skill:blast-radius` (what a change breaks elsewhere), `/skill:sharpen`, `/skill:bro`.
