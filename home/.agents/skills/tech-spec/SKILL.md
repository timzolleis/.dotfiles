---
name: tech-spec
description: Write a typed call-stack architecture handoff.
disable-model-invocation: true
---

# Tech Spec

A tech spec is a **typed call-stack architecture handoff**: code-shaped contracts plus execution flows. Prefer TypeScript pseudocode over prose wherever precision matters.

Treat `../coding-standards/` as the standards package and `../tdd/` as the testing workflow.

This skill is design-only. Do not implement. Save a file only when the user asks for a file; otherwise return the spec inline.

## Branch selection

1. Use **Path A: Convert context to spec** when the conversation, docs, or codebase already contain enough background to describe the change.
2. Use **Path B: Grill first** when the user wants a new spec but has not provided enough problem, constraints, design direction, affected code, or acceptance criteria.

If a question can be answered by exploring the codebase, inspect the codebase instead of asking.

Completion criterion: the branch is chosen from actual available context; missing architectural decisions are not invented.

## Path A: Convert context to spec

### 1. Load standards and local context

Read the repository's own instructions first. They win over everything below.

Load only the `../coding-standards/` topic files the change actually touches:

- `DOMAIN_MODELING.md` for new domain values, states, or transitions.
- `BOUNDARIES_AND_PARSING.md` for a new or changed runtime boundary.
- `ERROR_HANDLING.md` for a new failure taxonomy.
- `DESIGNING_MODULES.md` for a new seam or ownership move.
- `ASYNC_AND_WORKFLOWS.md` for cancellation, concurrency, retries, transactions, idempotency, or durable workflows.
- `TYPESCRIPT_CONTRACTS.md` for public contracts, casts, `any`, or exports.
- `EFFECT.md` for Effect Services/Layers, typed error channels, Schema, or Effect RPC.
- `OBSERVABILITY.md`, `TESTING_AND_VERIFICATION.md`, `VOCABULARY.md` when the spec makes a decision they own.

Do not load the whole standards package by default. If the repository already states a rule concretely, use the repository's version and skip the topic file.

Verify library APIs against the pinned source named in the global instructions, matching the repo's installed major.

Inspect existing code for local vocabulary, module layout, domain concepts, error handling, adapters, and test style.

Completion criterion: the spec uses project vocabulary and does not introduce a pattern, library, adapter, schema style, or test strategy before checking local precedent.

### 2. Extract the design problem

Capture:

- current state;
- problem;
- users/callers;
- goals;
- non-goals;
- constraints;
- invariants;
- affected systems;
- likely entrypoints;
- operational/runtime concerns;
- risks;
- open questions.

Mark unknowns as open questions instead of filling gaps with plausible design.

Completion criterion: every claimed requirement or constraint is grounded in conversation, code, docs, or an explicit open question.

### 3. Explore design alternatives

Produce alternatives only where a genuine trade-off exists. Do not invent options to satisfy a count; a spec with one obvious design states the design and the discarded direction in one line. When alternatives are real, they differ in interface shape, seam placement, ownership, call stack, runtime topology, or module boundaries — not just names.

For each alternative, sketch:

- domain types and state model;
- public/module interfaces and APIs;
- input/output types;
- expected failure types;
- seams, boundaries, and adapters;
- entrypoint-to-side-effect call stack;
- parsing/projection strategy;
- authorization, observability, cancellation, idempotency, and transaction flow when reachable;
- test seam strategy;
- tradeoffs.

Compare alternatives on:

- caller burden;
- module depth and leverage;
- locality of invariants and change;
- seam placement;
- boundary parsing and projections;
- error and cancellation model;
- testability through real seams;
- operational/runtime fit;
- implementation complexity.

Completion criterion: the recommendation is chosen after comparing alternatives, not before.

### 4. Specify the recommended typed contracts

For the recommended design, outline every new, changed, or deleted:

- domain value;
- branded/refined type;
- state machine variant;
- input/output type;
- request/response shape;
- function signature;
- class or module interface;
- expected-failure/custom-error type;
- adapter interface;
- protocol DTO;
- persistence DTO/projection;
- runtime-boundary codec;
- public API.

Name seams, adapters, implementations, ownership boundaries, and what crosses each boundary. State what each layer may know and what must not leak across the seam.

Completion criterion: every new or changed boundary has a concrete type/interface/API sketch, or an explicit reason no new contract is needed.

### 5. Specify call stacks and data flow

For every new, changed, or deleted behavior, show the call stack from entrypoint to side effects and response.

Include type/data flow:

```txt
raw input
  -> boundary DTO / unknown
  -> parser
  -> canonical domain/application input
  -> service/module interface
  -> adapter call
  -> typed result/error
  -> projection
  -> serialized output
```

Include current vs proposed flow when changing existing behavior. Include failure, retry, cancellation, transactionality, idempotency, observability, authorization, and runtime-hop flow when reachable.

Completion criterion: every affected behavior has an end-to-end call stack and type/data-flow trace.

### 6. Map files and modules

List:

- files/modules to add;
- files/modules to change;
- files/modules to delete, if any;
- test files;
- config/migration/runtime files, if any.

For each file, state the contract, code path, boundary, adapter, domain concept, or test responsibility it owns.

Completion criterion: every contract and call-stack step maps to a file/module or an open question.

### 7. Write the RGR TDD test plan

Use the sibling TDD workflow and testing standards. Plan vertical Red-Green-Refactor slices: one failing behavior test, minimal implementation, repeat. Do not write a horizontal "all tests first, all code later" plan.

Favor behavior through public interfaces and real seams over implementation-coupled mocks.

Cover proportionately:

- happy paths;
- failure paths;
- parser rejection and accepted shapes;
- domain invariants and state transitions;
- adapter contracts;
- persistence/runtime semantics;
- cancellation/retry/idempotency paths;
- observability and safe summaries where relevant;
- end-to-end flows for high-consequence behavior.

Completion criterion: every public behavior, invariant, important failure path, changed boundary, and changed seam has a red test slice or an explicit reason not to test it.

### 8. Produce the spec

Return the spec inline unless the user requested a file path. If a file was requested, save it there.

Do not implement and do not ask to implement by default.

Completion criterion: the output follows the outline below and is implementation-ready for another engineer.

## Path B: Grill first

1. Do not write a full spec yet.
   - State that there is not enough context for an implementation-ready tech spec.
   - Completion criterion: the agent has not invented requirements, APIs, files, or call stacks.
2. Start a grilling interview.
   - Use the `grill-me` skill to stress-test the direction one decision at a time.
   - Ask one question at a time and provide the recommended answer with each question.
   - If a question can be answered by exploring the codebase, inspect the codebase instead of asking.
   - Completion criterion: the interview has enough context for Path A: problem, users/callers, constraints, affected systems, desired behavior, boundaries, likely APIs, invariants, risks, and acceptance tests.
3. Convert to the spec.
   - Once grilling context is sufficient, run Path A.
   - Completion criterion: the final artifact is a typed call-stack architecture handoff, not interview notes.

## Spec outline

The spec is code with the minimum prose that makes it decidable. One numbered section per seam, then the call graph, then files and tests:

```md
# <Title>

One paragraph: what changes for the caller, and where it stops.
Naming or convention notes, if the spec introduces any.

## 1. <Seam name>

Typed contract: interface, inputs, outputs, expected errors, layers.
Semantics that the contract cannot express, as a short list.

## 2. <Next seam>
...

## Call graph

Production stack and test stack, entrypoint to effect to result.
Failure, retry, cancellation, idempotency, or observability flow only where reachable.

## Files to add / change / delete

## Test slices

RGR order: one failing behavior test, minimal implementation, repeat.

## Slices

One line per implementable slice, in dependency order. This is the work queue and the
record of what happened; it lives here so the spec stays the only artifact.

- [ ] 1. <name> — sections <n>, <n>
- [ ] 2. <name> — sections <n>

Mark a slice done only after its review is accepted, and append its outcome to the line.

## Open questions
```

Add `Goals`, `Non-Goals`, `Invariants`, `Constraints`, `Alternatives`, or `Risks` as their own sections only when the decision is not already visible in the contracts. Never omit typed contracts, seams, call stacks, tests, or slices because they are hard to specify.

A slice is one implementation and review target: self-contained, dependent only on earlier slices, and provable by its own tests. Size it so one run can hold the whole thing. Prefer fewer, larger slices over a dependency graph.

Delete from the current model explicitly. A spec that replaces a shape names what disappears.

## Writing rules

`AGENTS.md` owns the code-shape register: pseudocode for contracts, call stacks for behavior, prose for the why. A spec applies it to every affected seam instead of the one under discussion.

- Focus on types, interfaces, APIs, inputs/outputs, seams, boundaries, adapters, domain modules, service modules, external adapters, and call stacks.
- Prefer precise domain values over strings, booleans, nullable bags, and loosely shaped objects.
- Keep seams real: adapters translate framework, persistence, network, time, randomness, telemetry, runtime, or platform boundaries.
- Avoid speculative abstraction; every seam earns its existence through invariants, locality, leverage, testing, or a real boundary.
- Keep a single source of truth; do not restate the same rule in multiple sections unless one section points to the other.
- Unknowns stay open questions. Do not invent product requirements, domain rules, APIs, or call stacks to make the spec feel complete.
