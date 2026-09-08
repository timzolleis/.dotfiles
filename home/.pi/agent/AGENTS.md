Use plain technical English, guided by ASD-STE100 and Google developer documentation style.

Lead with the point. Bullets over prose. Everyday words. If you can't say it out loud easily, you don't understand it yet.
- When explaining behavior, show the call path: entry point → service → dependency → result or failure. Only when it helps.
- Name what fails and its effect: "The server confirms the write before saving it," not "violates ack-after-apply ordering."
- Short sentences, active voice, present tense. One term per concept; reuse existing domain terms; flag conflicts.

## Decision priority

When rules conflict, this order wins:

1. Correctness, safety, debuggability.
2. These rules, for all new code and for the full behavior being refactored.
3. The project file where it is more specific.
4. Compatible existing project conventions.
5. Contain incompatible existing patterns at the nearest boundary. Never copy them into new code.
6. Leave unrelated old code alone unless a migration is requested.

## Reference implementations

Before writing a module (repository, service, handler, codec, component, test), find the most recent implementation of the same kind. Analyze its shape. Copy it only if it conforms to the rules below. If it doesn't, tell me which rule it breaks and follow the rule, not the file. "Most recent" is a starting point, not proof of correctness.

## Legacy — do not imitate

These exist and compile. They are not the pattern.

- `Effect.Service` classes. New services use `Context.Tag` + `make` + `layer`/`layerNoDeps` + a declared `Service` interface. Ask before migrating existing ones.
- `Option`-checks for not-found, `findFirst → null → error` before writes, hand-rolled `$transaction` in repositories.
- Codecs that rename columns or override picked fields.
- Hand-written schemas for shapes that are generated or already exist as a domain model. Derive from the core module type or schema.
- Raw locale JSON imports, `../../../../` paths, hardcoded language or fallback strings inside logic.

## Workflow

Choose the primary workflow from this map:

| Task | Start with |
|---|---|
| Ask or explore something | No workflow skill |
| Feature, changed behavior, interface, or meaningful refactor | `design-first` |
| Approved plan or one named todo | `implement` |
| Reproduce and fix a bug | `diagnosing-bugs` loads automatically |
| Explicit test-first work at an agreed seam | `tdd` |
| Review a diff | `code-review` |
| Stress-test a design | `grill-me` |
| Edit skills or agent instructions | `writing-for-agents` |
| Switch sessions with unfinished work | `handoff` |

Load skills progressively. Start with the one primary workflow above. Load a specialist skill only when the current step needs its detailed guidance. Do not preload every skill whose description loosely matches. Coding standards remain automatic for matching code changes, but load only the topic references needed for the current concern.

Plans live in `plans/<kebab-case-name>.md` and follow `$HOME/.agents/skills/design-first/PLAN-FORMAT.md`.

## Rules — each one has a check

**Reuse first.** Before a new type, model, error, helper, component, formatter, label map, or fixture: grep the domain package, feature dirs, shared UI, and fixtures for the *concept*. Prefer in order: reuse as-is → extend the existing one → new only when reuse would couple unrelated things. Derive (`Pick`, `Schema.pick`, `typeof X.Type`); never redeclare. Two things that differ by a label or type are one thing with a prop. Never a second way to format a date, render an empty state, lay out a card, resolve a label, or toast.
*Check: every new name has a recorded probe.*

**Deletion test.** If deleting a module or helper makes complexity disappear, it was pass-through — delete it. If deleting it spreads complexity across callers, it earned its keep.
*Check: apply to every new service, wrapper, and helper.*

**Layers.** Handler: policy → decode → brand → one service call → response; if no service is needed, the handler calls the repository. Service: business rules and effect order; if it only forwards, delete it. A service depends on the narrowest port it uses (`Pick<Repository, 'findById'>`), not the whole repository. Repository: **one Prisma call per method** — org and owner in `where`, children through the parent, no pre-reads, no decisions, no defaults, no `$transaction`. Domain: `Schema.Struct` models, `Schema.Class` only when there is behavior; branded ids; tagged errors; pure rules returning `Either`; logic about a model lives on the model. Errors live in domain or HTTP, nowhere else. Components see response models, never rows.
*Check: no handler or repository contains a rule, default, or second call.*

**Codecs.** Row → model is pick + brand + flatten one relation. A rename means rename the column. An override means brand the row schema. A null-filter means a migration. Mapping styles are defined in the project file.
*Check: each codec transform does one thing.*

**Types.** Every id branded once at the boundary. Enums are literals. Variant payloads are tagged unions. Lifecycle states are tagged unions, not `isX` flags with optional dates. No boolean parameters that switch behavior — named options or domain types. `unknown`, `Record<string, unknown>`, `as`, `!`, `"x" in obj`, `string` where a brand fits — fix each. Invalid states unrepresentable. Two-plus params → one object.
*Check: grep the diff for each smell.*

**Effect.** `Effect.fn("Service.method")` on every method. `Match` over if-chains and ternaries. `Clock` / `DateTime` / `Duration`, never `new Date()`. `Effect.all` with `concurrency: "unbounded"` for independent work. One error-handling shape per file: `orDie` for reads with no failure mode, `handlePrismaError → domain error` for writes. Merge errors with the same recovery path. Never swallow a typed error a caller could act on. Spans, not logs. Any retryable mutation has an explicit idempotency strategy; never hold a transaction across a network call.

If you need to look up an effect API, check ~/.local/share/effect-repos/effect-v[3|4] (whatever version the repo you work in uses), never node_modules

**Frontend.** Forms via the project form library and resolver; pending from `formState`. No `useState`/`useEffect` mirroring props, form, or server state. Collections + `useLiveQuery` before hand-rolled fetch/cache. Route params from `Route.ComponentProps`. Each item owns its own state. Labels through the i18n helper. Notify on failure only.

**Names.** Say what it is or does, in the codebase's existing words: `applicationIsVisibleOn`, `findBy*`, `statusService`. Not `run`, `handle`, `process`, `effective`, `readiness` when the app says `state`. Exported symbols: 2–4 words, one of them a domain word, unique in one grep (`createStripeClient`, not `create`). Name and body agree; when behavior changes, rename in the same commit. One definition site per symbol — move, never copy. `XNotFoundError` with literal `reason`. camelCase identifiers, kebab-case files, no `utils.ts`/`types.ts`, whole literals for event names and error codes, error messages start with a unique literal prefix. Full rules: `write-discoverable-code` skill.
*Check: grep each new exported name; exactly one definition hit.*

**Comments.** Every export gets one doc line stating what the signature can't: units, timezone, ownership, ordering, and the plain-words phrase someone would grep for. Everything else: only a non-obvious *why*. No narration, banners, or "temporary" without a tracked follow-up.
*Check: every export has its line; every other comment is a why.*

**Tests.** Ask: if every dependency behaved perfectly, what could this layer still get wrong? Test that, and only that. Each decision is tested once, in the layer that owns it. A test that fails when a *dependency's* behavior changes is in the wrong layer.

- **Domain**: plain unit tests with `Model.make(...)`. No layers, no database. Most edge cases live here.
- **Repository**: real test database. Scoping, ordering, what `where` matches, cascade, decode. Not business rules. One short defect test for Prisma/decoder failures.
- **Service**: dependencies stubbed with fakes that honor the declared contract, including typed failures. Orchestration and decisions only. Call real domain rules; never fake them. Never re-test repository scoping.
- **Handler**: service stubbed. Decode, policy, response mapping: 400 / 403 / 404 / happy shape. Not what the service decides.
- **Component**: rendering and interaction against response models. Not data fetching.

Setup via shared fixtures and real repositories, never inline defaults or raw Prisma to fake state. Never mock the unit under test. A test file longer than the code it tests is testing another layer.
*Check: for each test, name the layer it belongs to; delete tests that belong elsewhere.*

**Scope.** Only files this task needs. No drive-by edits, no manual lockfile edits.

## Before you say "done"

Run this yourself. Do not hand it to me as review work.

1. Grep every new type, model, error, helper, component, label map, fixture name. Equivalent exists → merge or derive.
2. Grep the diff: `unknown`, `as `, `!.`, `!,`, `"in "`, `string` ids. Fix each.
3. Read every handler and repository in the diff. Rule, default, pre-read, `$transaction`, manual `updatedAt`, second table → move or report.
4. Read every codec. Rename, override, filter → push upstream.
5. Grep the diff: `useState`, `useEffect`, `Date.now`, `new Date`, `locales/`, if/else chains → derive, `Clock`, i18n, `Match`.
6. Every new error is in `packages/domain`. No re-export shims.
7. Grep every new exported name: one definition hit, 2–4 words, a domain word. Behavior changed → name changed.
8. Every export has its one doc line. Delete every other comment that isn't a *why*.
9. Tests: fixtures used, no raw Prisma setup, no test longer than the code it tests.
10. `git diff --stat`: every file belongs.
11. Run the project check and affected tests. Report what ran, what passed, what could not run.

Report format:
```
Changed         - <file>: <one line>
Left on purpose - <file>: <what> — <why>
Needs decision  - <problem> — A / B
```

## Behaviour

When the same mistake repeats, propose correcting the existing instruction that should prevent it. Add a new rule only if no existing rule covers it; ask before changing instructions.

Debug from evidence. Form a hypothesis, run a focused check, then edit. After two failed fixes, stop and report: what you observe, what you expect, what you tried and what each result shows, the next useful check or the decision you need from me.
