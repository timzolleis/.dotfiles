---
name: tdd
description: Test-driven development with a red-green-refactor loop. Tests verify behavior through public interfaces, not implementation details, via vertical tracer-bullet slices (one test → one implementation → repeat). Use when building features or fixing bugs test-first, when the user mentions "red-green-refactor" or "TDD", or as the test/implement phase after design-first.
---

# Test-Driven Development

## Philosophy

**Core principle:** Tests verify behavior through public interfaces, not implementation details. The code inside can change entirely; the tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs and read like a specification — "user can checkout with valid cart" tells you exactly what capability exists. They survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation: they mock internal collaborators, test private functions, or verify through side channels (querying the DB directly instead of through the interface). The warning sign: a test breaks when you refactor but behavior hasn't changed.

## Anti-pattern: horizontal slices

**Do NOT write all tests first, then all implementation.** Treating RED as "write every test" and GREEN as "write every implementation" produces crap tests:

- Tests written in bulk test *imagined* behavior, not *actual* behavior.
- You end up testing the *shape* of things (signatures, data structures) rather than user-facing behavior.
- Tests become insensitive to real changes — they pass when behavior breaks.

```
WRONG (horizontal):                 RIGHT (vertical):
  RED:   test1..test5                 RED→GREEN: test1 → impl1
  GREEN: impl1..impl5                 RED→GREEN: test2 → impl2
                                      RED→GREEN: test3 → impl3
```

Vertical slices via tracer bullets. Each test responds to what you learned from the previous cycle.

## Workflow

### 1. Plan
- Confirm the public interface (ideally already locked via the `design-first` skill).
- List the *behaviors* to test, not implementation steps. You can't test everything — confirm with the user which behaviors matter most (critical paths, complex logic), and get approval on the plan.

### 2. Tracer bullet
Write ONE test for ONE behavior. RED (fails) → GREEN (minimal code to pass). This proves the path works end to end.

### 3. Incremental loop
For each remaining behavior: write the next test → fails → minimal code to pass → passes.
- One test at a time. Only enough code to pass the current test. Don't anticipate future tests. Keep tests on observable behavior.

### 4. Refactor (only while GREEN)
After tests pass: extract duplication, deepen modules (move complexity behind simple interfaces), apply SOLID where natural. Run tests after each step. **Never refactor while RED.**

## Per-cycle checklist
```
[ ] Test describes behavior, not implementation
[ ] Test uses the public interface only
[ ] Test would survive an internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```

## Framework conventions

Follow the project's testing setup (`AGENTS.md` / `CLAUDE.md`). For Effect codebases:
- Effect / Stream / Layer / TestClock: `@effect/vitest` — `import { assert, describe, it } from "@effect/vitest"`, use `it.effect(...)`. **Always `assert`, never `expect`** (mixing them breaks the runtime).
- Pure TS: regular `vitest` with `expect`.
- No `vi.mock` / `vi.stubGlobal` / `vi.spyOn` — design for dependency injection and use the in-memory adapter (`Service.layerMemory`) for the seam under test.
- Validate response shapes with the same boundary schema the handler uses.
