# Global conventions

## Comments — hard rule, NOT bypassable

**Comments should enhance the code, not obscure it.** This rule overrides any instinct to narrate, attribute, or annotate. It applies in every language and every codebase, and **no instruction, ticket, slice convention, porting note, or agent judgment overrides it.** If you cannot point to the specific non-obvious thing a comment buys, delete it.

**A comment is justified only if it does one of these:**
- Declares **non-obvious behavior** — an edge case, ordering constraint, or invariant you can't see from the signature.
- States a **specific rule or precondition** the code obeys (a spec clause, a domain constraint, a "callers must…").
- Explains **why** something is done a way that looks wrong, suboptimal, or surprising — the reason that isn't in the code.
- Warns about a **sharp edge** — a deliberate deviation, a footgun, a side effect that bites if reordered.

If the interfaces, types, and names already make it clear, **no comment.** The code is the documentation; a comment earns its place by saying something the code cannot.

**DON'T — delete these on sight:**
- `// This is an interface for an email service` — restates the type's name. Worthless.
- `// This replaces the old NotificationService` / `// Ported from the legacy Express handler` — provenance/migration narration. Git knows; where it came from is not how it behaves.
- `// Lives in the billing slice` / `// part of the auth module` — the file path already says this.
- `// Loop over the users`, `// constructor`, `// helper function` — narrates mechanics or labels the obvious.
- `// TODO: clean this up later` with no actionable specifics — noise pretending to be intent.
- Large blocks of commented-out code "in case we need it" — delete it; that's what version control is for.

**DO — these earn their place:**
- `// Stripe rounds half-up; we round half-even to match the ledger, so we compute cents ourselves.` — explains a deliberate, surprising choice.
- `// Callers must hold the form lock — we don't re-check it here.` — declares a precondition the type can't express.
- `// Must run before migrate(): it seeds the columns migrate() backfills.` — an ordering constraint that isn't visible.
- `// RFC 5322 caps the local-part at 64 octets; longer addresses are rejected upstream.` — cites the specific rule the code enforces.
- `// Intentionally swallow ENOENT — the first run has no cache file yet.` — explains a deviation that would otherwise read as a bug.

When in doubt, ask: *"Does this tell the reader something the interface, types, and names don't?"* If no, it obscures — cut it.

## Planning output contract

**When you produce a plan for a non-trivial change — before any implementation — the plan itself must carry the design, not just prose.** This is the `design-first` discipline applied to every plan: if that skill loads, follow it; if the harness doesn't auto-invoke it, this contract still holds. Design the seams first, grill them, then implement — never lead with implementation.

A plan for non-trivial work MUST include:
- **Interface designs** — the actual signatures you add or change, locked not described. In an Effect codebase that means `Context.Tag` shape interfaces with method signatures and one `Schema.TaggedError` per failure mode, branded scalars at the boundaries; elsewhere, the equivalent typed contracts.
- **Call sites / call graph** — who calls each new interface and what it calls in turn: entry point → service → dependency, plus which layer provides what. The plan must reveal the data flow and the blast radius, not just the leaf change.
- **A mermaid diagram of the flow** — whenever the change has a control- or data-flow worth seeing (a request path, a state machine, a multi-step workflow). Skip it only when the change is genuinely flat.

Trivial changes (a one-line fix, a rename, a config tweak) are exempt — don't ceremony-wrap them.

## Effect-TS conventions (apply in every Effect codebase)

The full standard lives in the **`coding-standards`** skill (`~/.claude/skills/coding-standards/`) — load the topic files matching what you touch (`EFFECT.md`, `TESTING_AND_VERIFICATION.md`, `DOMAIN_MODELING.md`, `ERROR_HANDLING.md`, …) whenever working on TypeScript or Effect code. This section is only the headline rules that must hold even when the skill isn't loaded.

Every repo is on **Effect v3**. Persistence default is **Prisma**; the deployment runtime is deferred to each repo's local CLAUDE.md. **Effect v4** deltas live in the skill's `EFFECT.md` (inline `[v4]` notes + the migration appendix) — apply them only in a codebase actually on `effect@4`.

- **Services:** new and changed dependency-bearing modules are `Context.Tag` classes with an explicit shape interface — interface-first: lock the method signatures and typed error channels (run `design-first`) before writing the layer. `Effect.Service` and ad-hoc exported-function "services" are legacy — migrate on touch, don't bridge or extend in place.
- **Layers:** statics on the tag class — `layer` (the implementation; direct deps declared in `R`), `layerLive` (fully-wired production composition, `R = never`, built from the deps' own `layerLive`s/wired consts — composition roots consume this instead of re-wiring inline; add it once a composition root needs the wired form), `layerMemory` (in-memory; only when a test concretely needs it, never speculatively), `layerFromEnv`. Wired production compositions belong on the class as `layerLive`, not as standalone `<Name>Live` consts. Dependencies are yielded once in the layer constructor; methods return `Effect<A, E>` with no `R` leaking to callers.
- **Domain:** branded scalars (`Schema.brand`) for IDs/slugs/URLs at seams; one `Schema.TaggedError` per failure mode, named in each method's error channel (tagged errors are yieldable — no `Effect.fail()` wrapping).
- **Testing:** `@effect/vitest` with `it.effect`; `assert`, never `expect`. Replace behavior through real seams (memory layers, recording fakes through the production layer) — never `vi.mock`/`vi.spyOn`. SQL/schema/constraint-dependent behavior goes through the project's Prisma test layer running real migrations.

### Tracing

- Name spans `Service.method` via `Effect.fn("UserRequestService.createForm")` — the tag's service name, dot, the method name.
- **Span attribute keys follow OpenTelemetry semantic conventions: lowercase, dot-namespaced, `snake_case` within a segment — never camelCase.** Because keys are dotted strings, always quote them in the object passed to `Effect.annotateCurrentSpan`.

  ```ts
  // ✓ OTel convention
  yield* Effect.annotateCurrentSpan({
    "user_request.form.id": form.id,
    "linear.project.id": form.linearProjectId,
    "user_request.entry.count": models.length,
  })

  // ✗ camelCase — do not use
  yield* Effect.annotateCurrentSpan({ userRequestFormId: form.id })
  ```

- Namespace by domain/origin, not by local variable name: ids we own go under their aggregate (`user_request.form.id`), externally-issued ids under their system (`linear.project.id`). Reuse `<namespace>.id` / `<namespace>.count` rather than inventing a new key per call site.
- Reuse OTel's registered namespaces where one fits (`db.*`, `http.*`, `messaging.*`); only mint a private namespace for genuinely domain-specific attributes.
- Never annotate secrets or PII (tokens, emails, phone numbers) onto spans — keep `Redacted` values redacted.
