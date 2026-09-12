---
name: tdd
description: Test-driven development through pre-agreed public seams using vertical red → green tracer bullets.
disable-model-invocation: true
---

# Test-Driven Development

TDD is a red → green loop through public interfaces. Tests describe observable behavior and survive internal refactors.

Read the nearest project testing instructions first. They own framework choice, fixtures, database use, test-layer boundaries, and verification commands. Use [`tests.md`](tests.md) to check test quality and [`mocking.md`](mocking.md) to choose a test double.

## Agree the seam

Before writing a test, name the public seam and behaviors under test. Use seams already approved in the spec. If the seam is absent or disputed, say so and report it as a deviation instead of inventing it silently.

A good test:

- exercises the public interface;
- reads like a behavior specification;
- uses expected values from an independent source such as a literal example or spec;
- fails when that behavior breaks, not when internals move.

Avoid tests of private functions, internal call sequences, tautological expectations, module mocks, and side-channel verification.

## Run vertical slices

For each behavior:

1. **Red:** write one test and run it to observe the expected failure.
2. **Green:** add only enough implementation to pass that test.
3. Run the focused test and relevant typecheck.
4. Repeat with the next behavior, using what the previous slice taught you.

Do not write all tests before all implementation. Do not anticipate later slices. Refactor only while green, then rerun the focused check.

## Effect projects

Follow the repository's Effect version and test conventions. Unless the repository says otherwise:

- use `@effect/vitest` and `assert` for Effect code;
- use ordinary Vitest for pure TypeScript;
- replace dependencies through Effect services and Layers rather than `vi.mock`, global stubs, or spies;
- use a real test database when SQL, constraints, transactions, cascades, or row decoding are the behavior;
- use faithful or recording test implementations for orchestration;
- validate boundary responses with the boundary schema.

Finish by running the complete affected checks named by the repository or approved spec.
