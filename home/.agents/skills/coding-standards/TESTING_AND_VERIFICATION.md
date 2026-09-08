# Testing and Verification

Tests should prove behavior through the same interfaces callers use. Confidence comes from observable outcomes at real seams, not from spying on implementation details.

## Vocabulary

**Behavior Test** — A test that asserts observable input/output behavior through a module's public interface or intentional system seam.

**Real Seam Test** — A test that replaces behavior through an intentional production seam: constructor-injected dependency, Effect service/layer, local database, in-memory/fake adapter, or runtime-provided binding.

**Property Test** — A test that checks a general property across generated inputs rather than only examples.

**Arbitrary** — A Fast-Check generator for valid or intentionally invalid test values, preferably colocated with the domain module it supports.

**Risk-Matched Evidence** — Verification where each material changed invariant, failure path, boundary, async behavior, persistence/runtime assumption, or user-visible consequence has proportionate evidence through the caller-facing interface or representative runtime.

## Non-negotiables

- Tests assert observable outcomes: returned values/failures, persisted state, emitted messages, rendered responses, sent fake-adapter records, or runtime effects.
- Tests do not depend on private helpers, internal call order, or incidental implementation structure when behavior can be tested through the interface.
- Tests do not prove that a library, framework, runtime, or dependency implements its own documented contract. Test only the changed module's configuration, mapping, policy, or use of that contract.
- Do not use module-patching APIs such as `vi.mock`, `jest.mock`, or equivalents.
- Do not use method-spy APIs such as `vi.spyOn`, `jest.spyOn`, or equivalents.
- When replacing behavior, replace it through a real seam.
- Production External Adapter Modules are tested through the same service-facing interface callers use.
- Tests that make deterministic claims control time, randomness, IDs, external dependencies, and cancellation when those inputs affect the outcome.
- A test must fail when the claimed behavior is absent.

## Verification completion criterion

Verification is complete when every material changed behavior, invariant, failure path, boundary, async behavior, persistence/runtime assumption, or user-visible consequence has proportionate evidence through the caller-facing interface or representative runtime.

If a representative environment is unavailable, name the unproven claim instead of presenting a lower-level test as proof.

## Strong defaults

- Prefer e2e tests for critical user flows.
- Prefer integration tests through real seams for External Adapter Modules and Service Module orchestration.
- Use focused behavior tests and property tests for pure Domain Modules.
- Use property tests for parsers, smart constructors, state machines, serialization round trips, normalization, idempotence, and lawful combinators when properties express the invariant better than examples.
- Colocate tests with the owning module using `.test.ts` / `.test.tsx` unless the repository has an established different layout.
- Run tests through the project's runner (e.g. `pnpm <app> test`); import ordinary test APIs from `vitest` unless Effect-specific testing applies.
- In non-Effect Vitest property tests, use the project-standard Fast-Check integration such as `@fast-check/vitest`.
- In Effect projects, use `@effect/vitest` (`assert`, never `expect`) and Effect Schema-derived generation as described in [`EFFECT.md`](EFFECT.md).

## Behavior through interfaces

Prefer:

```ts
const result = await passwordReset.requestReset(email);

expect(result).toEqual(ok({ delivery: "queued" }));
expect(emailAdapter.sentEmails).toContainEqual({ to: email, template: "reset" });
```

The fake adapter is supplied through the production seam and exposes records for assertions.

Avoid:

```ts
const sendSpy = vi.spyOn(emailProvider, "send");
await passwordReset.requestReset(email);
expect(sendSpy).toHaveBeenCalledWith(...);
```

Interaction assertions are acceptable only when the interaction is the observable behavior, and then a fake/recording adapter supplied through a seam should own the record.

## No module mocks

Avoid:

```ts
vi.mock("../send-email", () => ({ sendEmail: vi.fn() }));
```

Prefer explicit seams:

```ts
const emails = new RecordingEmails();
const passwordReset = new PasswordReset(users, emails, clock);
```

Module mocks patch hidden dependencies. They encourage code without seams and tests coupled to implementation structure.

## Risk-matched evidence

Match evidence to risk:

- **Focused changes** verify changed behavior through the owning module interface.
- **Elevated changes** also verify affected external, persistence, concurrency, or runtime seams.
- **Critical/high-consequence flows** verify the end-to-end flow when a representative environment exists.

Do not demand tests just because lines changed. Map each material changed invariant, failure path, boundary, async behavior, or runtime assumption to evidence, and prefer the highest-confidence proof that remains proportionate. If a representative environment is unavailable, state which claim remains unproven rather than pretending a lower-level test proves it.

## Test only what the code decides

Ask of the code under test: **what would still be wrong if every dependency were perfect?** That answer is the test. Data a layer only forwards belongs to the layer that produces it; asserting it twice buys no confidence and breaks twice.

| Layer | What it decides |
|---|---|
| HTTP handler | rejecting malformed input, authorizing, request → call args, failure → status |
| Service | ordering, transactions, compensation, which collaborator runs when |
| Repository / adapter | query semantics, constraint violations, row ↔ domain mapping |
| Presenter / mapper | domain → wire shape, and what a missing lookup does |
| Domain module | rules, invariants, transitions |

What remains is grid coverage, so favour breadth over depth: walk every case × every failure through a table rather than asserting one case exhaustively.

Signs a test sits at the wrong layer:

- the assertion restates what the fake was told to return;
- the assertion proves generic library or framework behavior instead of a choice made by the named production module;
- the fixture carries fields the code under test never reads;
- a dependency is faked only so an unrelated layer can run in-process — stub that layer instead, and the rig shrinks with it.

## Domain behavior and properties

Parsers, smart constructors, transitions, and pure decisions need focused behavior tests. Use properties where the invariant is general:

```ts
it.prop("normalization is idempotent", [emailAddressArbitrary], (email) => {
  expect(EmailAddress.normalize(EmailAddress.normalize(email))).toEqual(EmailAddress.normalize(email));
});
```

Valid arbitraries construct through production parsers/schemas/smart constructors or derive from them. Do not bypass invariants to create convenient test data.

Generate invalid boundary inputs when testing rejection, but do not label them valid domain values.

## Persistence behavior

When correctness depends on SQL, schema constraints, transactions, migrations, or query semantics, use a representative database — **persistence default is Prisma**.

For Prisma persistence tests:

- exercise the production repository / External Adapter Module through its service-facing interface (e.g. the project's `PrismaService` test layer such as `prismaServiceTestLayer`);
- run the **real migrations** (or migrate straight from `schema.prisma`) before the suite, against a representative database — not a hand-rolled in-memory substitute;
- regenerate the Prisma client after schema changes so a stale client and a fresh test DB cannot silently disagree.

A hand-written in-memory fake is not proof of SQL/schema/transaction behavior — it proves the External Adapter Module's contract shape, nothing about the database.

## Runtime behavior

**The deployment runtime is deferred to local repo instructions.** When a claim depends on
deployment-runtime semantics (edge/serverless/Workers APIs, platform bindings and generated `Env`,
runtime serialization/structured clone, runtime hops), verify it on a representative runtime per the
local repo's testing guidance, not in a plain Node test. These global standards stay
runtime-agnostic; the concrete runtime test harness is a local concern.

Node-only tests are not proof of deployment-runtime-specific behavior.

## Boundary and failure evidence

Changed parsers verify accepted and rejected shapes.

Changed projections verify intended consumer-facing output.

Changed codecs verify owned directions and round trips when both directions are owned.

Changed expected-failure, cancellation, retry, idempotency, or compensation paths are tested by observing semantic outcomes, not internal calls.

## Test integrity

Avoid:

- tests that only execute a path without assertions;
- returning `false` from a property callback without making the test fail;
- snapshots that do not encode stable semantics;
- retries that hide flakiness;
- mutable fixture state leaking through shared layers/resources;
- loose equality (`assert.equal`, `==`) where `null` versus `undefined` is the behavior under test.

## Rejected framings

- **"It's a unit test, so mocks are fine."** The seam matters more than the test label.
- **"We tested the private helper."** Callers use the module interface; tests should too.
- **"Coverage went up."** Coverage is not behavior evidence.
- **"It flows through this layer, so this layer's test should assert it."** Passing data through is not deciding it. Test where the decision is made.
- **"A fake proves database behavior."** Fakes prove External Adapter Module contract behavior, not SQL semantics.
- **"Node tests cover runtime-specific code."** Only when the behavior does not depend on deployment-runtime APIs; otherwise verify on a representative runtime per local instructions.

## Review checklist

Use this as the final scan after applying the rules above; the rule source of truth remains in the relevant sections.

- Exporting internals just to test them.
- Asserting downstream behavior the code under test only forwards.
- Verifying interactions with spies instead of observing fake adapter records.
- Skipping rejected parser cases.
- Bypassing smart constructors in test factories.
- Not running real migrations in persistence tests.
- Claiming runtime-hop serialization works without running in the runtime.
- Forgetting to control clocks, random IDs, cancellation, or External Adapter Modules.
