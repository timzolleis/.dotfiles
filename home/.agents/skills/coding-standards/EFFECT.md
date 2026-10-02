# Effect

Status: **Settled for Effect v3 (current); v4 deltas labeled inline.**

Every codebase here is on **Effect v3** (`effect@3.21.x`, `@effect/vitest@0.29.x`) today. The
v3 guidance is authoritative. Sections marked **[v4]** apply only once a codebase is actually on
`effect@4` (still beta — APIs may shift between beta releases). Do not apply a **[v4]** delta to a
v3 codebase. Always check the installed version before using version-specific examples.

Load this file when changed behavior is already organized around Effect or uses Effect-specific
semantics: Services, Tags, Layers, typed error channels, Schema, Redacted values, Effect-aware
tests, Schema-derived generation, scoped resources, or established Effect RPC.

## Non-negotiables

- A responsibility already organized around Effect continues using the established Effect mechanisms for dependency provision, schemas, and Effect-aware testing.
- Do not introduce parallel constructor-injection, schema, or testing architecture inside an Effect responsibility without a concrete interoperability need or explicit architectural rationale.
- Dependency-bearing modules use Effect Services/Tags/Layers rather than ad hoc dependency bags.
- Expected failures in Effect-based modules use Effect's typed error channel.
- Effect custom errors use the repository's established tagged-error mechanism: `Schema.TaggedError` (v3) / `Schema.TaggedErrorClass` **[v4]**.
- When Effect is the established schema model, use Effect Schema for refined values and schema-derived domain construction.
- Sensitive values use Effect's `Redacted` value type.
- Layers that construct cleanup-requiring resources own acquisition and cleanup.
- Effect version assumptions are checked against installed versions before applying version-specific examples.

## Adoption boundary

Do not require Effect adoption for code that is not already organized around Effect. General
standards still apply: typed expected failures, boundary parsing, deep modules, real-seam tests,
cancellation, observability, and TypeScript contracts.

When a local responsibility is Effect-based, preserve the local Effect style unless it violates a
settled standard here.

## Service and Tag declaration form

**`Context.Tag` is the standard for new and changed dependency-bearing modules. `Effect.Service`
and ad-hoc exported-function "services" are legacy** — migrate a legacy module to the Tag form when
you change it; do not bridge or extend it in place.

This is an **interface-first** policy: a declaration-merged `Service` namespace interface is the
module contract. Design its method signatures and typed error channels before writing the layer that
implements them.

```ts
export class Foo extends Context.Tag("app/Foo")<Foo, Foo.Service>() {
  static layer = Layer.effect(Foo, Effect.gen(function* () { /* prod adapter, deps in R */ }))
  static layerLive = Foo.layer.pipe(Layer.provide(Dep.layerLive)) // fully wired, R = never
  static layerMemory = Layer.sync(Foo, () => /* in-memory adapter, only when a test needs it */)
}

export declare namespace Foo {
  export interface Service {
    readonly operation: (args: OperationArgs) => Effect<OperationResult, OperationError>
  }
}
```

- Layers are statics on the Tag class. Dependencies are yielded **once** in the layer constructor; methods return `Effect<A, E>` with **no `R` requirement** leaking to callers.
- Domain operations do not construct production Layers as part of ordinary business behavior. Layer composition / the application composition root owns construction, configuration, and resource wiring.
- Raw config parsing remains a boundary/composition concern.

**[v4]** `Context.Tag`, `Effect.Tag`, and `Effect.Service` all collapse into `Context.Service`, so
the "`Effect.Service` is legacy" framing is moot under v4 — but the interface-first intent is
unchanged. Class form (note the flipped arg order):
`class Foo extends Context.Service<Foo, Foo.Service>()("app/Foo") {}`. Keep the declaration-merged
`Foo.Service` interface. No auto `.Default` / `dependencies`; define layers explicitly and wire deps
via `Layer.provide`.

## Layer naming

- `Service.layer` — the implementation; direct dependencies declared in `R`.
- `Service.layerLive` — fully-wired production composition (`R = never`): `layer` provided with each dependency's own `layerLive` (or wired const). Composition roots consume `layerLive` instead of re-wiring deps inline; **only add it once a composition root needs the wired form**. Shared consts (e.g. a `PrismaServiceLive` singleton) referenced from multiple `layerLive` trees are memoized by reference — one instance per runtime build.
- `Service.layerMemory` — in-memory adapter; **only add when a test concretely needs it**, never speculatively.
- `Service.layerFromEnv` — built from environment config (only where needed).

Wired production compositions belong on the class as `layerLive`, not as standalone `<Name>Live` exported consts (legacy form — migrate on touch).

**[v4]** The names invert to match Effect v4 upstream: the bare `layer` becomes the fully-wired production composition (`R = never`), and the raw implementation with deps in `R` is renamed `layerNoDeps`. So v3 `layer`→ v4 `layerNoDeps`, v3 `layerLive`→ v4 `layer`; `layerMemory`/`layerFromEnv` are unchanged (test/env variants may also use `layerTest`/`layerConfig`).

**Testing-seam pattern — pick based on where the logic lives:**
1. **Logic is in X, dependency is external** → test X's real `.layer`, providing a `layerMemory` or `Layer.succeed` stub for its *dependency*. Don't stub X itself.
2. **X wraps I/O with no logic of its own** → add `X.layerMemory` so services that depend on X can test without the real backend.
3. **One-off dependency a test just needs to satisfy** → `Layer.succeed(X, stub)` inline; no dedicated `layerMemory` needed.

## Typed errors

Expected failures belong in Effect's typed error channel. Do not convert ordinary domain, parse,
authorization, dependency, persistence, or workflow failures into unchecked defects merely because
an Effect can die.

Use the local established tagged-error mechanism. v3:

```ts
class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}
```

**[v4]** `Schema.TaggedErrorClass<UserNotFound>()("UserNotFound", { userId: UserId })`. HTTP errors
move to `Schema.TaggedErrorClass(..., { httpApiStatus: 4xx })` instead of
`Schema.TaggedError(...) + HttpApiSchema.annotations({ status })`.

Keep error unions precise at module boundaries. Broad app-level failures belong near orchestration,
rendering, logging, and entrypoints. Tagged errors are yieldable — no `Effect.fail()` wrapping
needed.

## Schema and parsing

When Effect Schema is established, use it for:

- boundary parsing;
- refined/branded domain values;
- codecs for runtime boundaries;
- schema-derived generated values in tests.

A successful schema parse should produce the refined value that flows inward. Do not parse and then
keep using the unrefined input.

Validation happens at boundaries (HTTP handlers, repository mappers, env/config). Inside the app,
data already carries branded types — never re-validate (`BrandedId.make()`) or cast (`as BrandedId`)
except in mappers and input handlers.

> **[v4]** Schema is the largest single delta in v4. Consult the Schema migration guide before
> touching models/ids/value objects in a v4 codebase.

## Redacted values

Use Effect's `Redacted` value type for tokens, credentials, API keys, passwords, and secrets. Wrap
secrets at the boundary and unwrap only inside the adapter that needs the raw value. Observability
rules own no-leak behavior and safe summaries.

## Resource lifecycle

Layers that acquire resources also release them. Keep acquisition/cleanup in Layers or composition
roots, not scattered through domain operations. Shared/scoped Layers in tests must preserve managed
teardown and must not leak mutable fixture state between tests.

## Effect RPC

If a codebase already uses Effect RPC, use its schema and transport model consistently for
applicable typed RPC seams. This standard does not require adopting Effect RPC where another
established RPC model exists.

## Tracing

Effect tracing detail is owned by the global Effect conventions and `OBSERVABILITY.md`. The settled
rule: name spans `Effect.fn("Service.method")` (the Tag's service name, dot, method name) and
annotate spans with OpenTelemetry semantic-convention keys — lowercase, dot-namespaced,
`snake_case` within a segment, quoted (`"user.id"`, `"<entity>.count"`), never camelCase. Annotate
ids only; never secrets or PII.

## Testing

Use `@effect/vitest`, not a separate Fast-Check vitest integration — Effect depends on Fast-Check
and `@effect/vitest` owns the integration. Keep `effect` and `@effect/vitest` on matching versions
and re-audit testing/schema-generation assumptions when either is upgraded.

Run tests through the project's runner (e.g. `pnpm <app> test`); import ordinary test APIs from
`vitest`, and Effect-aware APIs from `@effect/vitest`. In Effect tests use `assert`, never `expect`
(mixing them breaks the Effect runtime).

Prefer Effect-aware tests and test services:

- `it.effect` for effects under Effect test services;
- `it.live` only when the test intentionally verifies live runtime behavior;
- `it.scoped` for scoped resources; `it.layer(...)` for service tests with managed teardown;
- `it.effect.prop` for properties whose predicate returns an Effect, especially with Effect Schema or test services.

Property callbacks must assert or return a failing Effect when false. Merely succeeding with boolean
`false` does not fail the test.

> **[v4]** Audited against `effect@4.0.0-beta.85` / `@effect/vitest@4.0.0-beta.85`: pass schemas to
> `it.effect.prop` in **tuple** form (record form is for Fast-Check arbitraries); schema-generation
> laws can use `TestSchema.Asserts` (`.arbitrary().verifyGeneration()`,
> `verifyLosslessTransformation({ params })`, focused `decoding()` / `encoding()`). Re-check these
> after any Effect upgrade.

## Schema-derived generation

Effect Schema is the default source of valid generated domain values. Built-in schema constraints
should guide generation before rejection filtering. Do not hand-duplicate a schema's arbitrary in a
separate factory unless the schema cannot derive an efficient/meaningful generator.

Verify the arbitrary-derivation API against the installed Effect version — `Arbitrary.make(schema)`
in v3, `Schema.toArbitrary(schema)` **[v4]** — rather than assuming one form.

## Runtime and persistence

- **Persistence default is Prisma** (with the project's `PrismaService` / generated effect client). Test SQL/schema/constraint-dependent behavior against a representative database through the project's Prisma test layer that runs real migrations — a hand-rolled in-memory fake is not proof of SQL behavior. See `TESTING_AND_VERIFICATION.md`.
- **The deployment runtime (Node, edge, serverless, Workers, …) is deferred to each repo's local instructions.** Keep these standards runtime-agnostic; do not bake a platform model into core or domain code. Platform bindings, deployment topology, and runtime-hop semantics live in the local repo's CLAUDE.md / patterns, not here.

> **[v4]** `effect-prisma-generator` is v3-only (its output uses `Runtime`, `Effect.Service`,
> `Context.Tag`). When migrating, prefer a hand-rolled effectful `PrismaService` over the few ops
> actually used, or move to a native-v4 SQL layer. Don't gate migration on forking the generator.

## Rejected framings

- **"Effect is present somewhere, so all new code must use Effect."** Only use this file for responsibilities that depend on Effect-specific semantics or established Effect architecture.
- **"Effect lets failures die."** Expected failures stay in the typed error channel.
- **"`Effect.Service` is fine for new modules."** It is legacy; new/changed dependency-bearing modules use the `Context.Tag` interface-first form (collapsing to `Context.Service` under v4).
- **"Any Layer shape is fine."** Follow the `layer` / `layerLive` / `layerMemory` / `layerFromEnv` naming (v4: `layerNoDeps` / `layer` / …, per the Layer naming section) and keep resource ownership explicit.
- **"Version-specific examples are universal."** Check the installed Effect version before applying **[v4]** guidance.

## [v4] migration appendix — apply only on `effect@4`

Beyond the inline **[v4]** notes above (Context.Service collapse, layer naming, tagged errors, Schema, Prisma generator), these deltas matter when actually migrating. Full guide: `github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md`. v4 is beta — re-verify against the installed beta.

- **Packages:** single-version ecosystem — `effect@4.x` with every `@effect/*` pinned to the same beta. HTTP moves into core: `@effect/platform` (Http/HttpApi) → `effect/unstable/http` + `effect/unstable/httpapi`; `unstable/*` modules may break in minor releases.
- **Service construction:** `Effect.Service({ effect })` → `Context.Service(..., { make })` + `static layer = Layer.effect(this, this.make)`.
- **Error combinators:** `catchAll`→`catch`, `catchAllCause`→`catchCause`, `catchSome`→`catchFilter` (now `Filter`-based); `catchTag`/`catchTags`/`catchIf` unchanged.
- **HttpApi:** endpoints take a config object — `HttpApiEndpoint.get("name", "/path", { params, headers, payload, success })`, not `.setPath()/.setPayload()/.addSuccess()` chains; path params arrive as `ctx.params`. Middleware: `class M extends HttpApiMiddleware.Service<M, { provides: X }>()("id", { error, security })`, implemented via `Layer.effect(M, …)` returning the per-request middleware effect (outer builds once, inner runs per request). Web handler: `HttpRouter.toWebHandler(Layer)` returns `{ handler, dispose }` taking only a `Request`; per-request context flows through a `Context.Reference` set with `Effect.locally`.
- **Runtime:** `FiberRef` → `Context.Reference`. `Runtime<R>` is removed — use `Effect.context<R>()` + the `Effect.run*With(services)` family. Layer memoization is shared across `Effect.provide` calls within a fiber (built once); opt out with `Layer.fresh` or `Effect.provide(l, { local: true })` — still prefer composing layers over multiple provides.

## Known gaps for future grilling

This file intentionally does not settle: Layer granularity and composition conventions; expression
composition and pipeline style; runtime ownership outside entrypoints; native fiber interruption
conventions beyond general cancellation propagation; schedules, retries, timeout composition, and
batching idioms; stream architecture; transaction integration; Effect RPC adoption criteria.
