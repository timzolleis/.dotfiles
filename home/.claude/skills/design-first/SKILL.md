---
name: design-first
description: Interface-first engineering loop. Design the interfaces, call sites, tags, and errors WITH the user as a concise TypeScript spec; lock the design through grilling and line-anchored feedback; write behavior tests against the locked interface; only then implement. Use when starting a feature, refactor, or rewrite where the design matters more than speed, or when the user says "design first", "spec this out", "outline the interfaces/seams/call sites", or "let's design it before coding".
---

# Design First

A solid, agreed-upon design is the product of this skill. Implementation is a downstream, mechanical step. **Never write implementation code before the design is locked and tests exist against it.** When the design turns out wrong, rewind and redesign — do not polish a flawed shape.

The output that matters is a **concise interface spec in TypeScript pseudocode**: service interfaces, branded domain types, tagged errors, the call graph, seams, adapters, and layer composition. Signatures and wiring — no implementation bodies — until the design is locked.

## Vocabulary (use these words exactly)

From *A Philosophy of Software Design*. Consistent language is the point — don't drift into "component," "boundary," or "helper."

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: much behavior behind a small interface. Deep = good. Shallow = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behavior can change without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete implementation satisfying an interface at a seam.
- **Leverage** — what callers gain from depth. **Locality** — what maintainers gain: change concentrated in one place.
- **Deletion test** — imagine deleting the module. If complexity vanishes, it was a pass-through. If it reappears across N callers, it earns its keep.
- **The interface is the test surface.** **One adapter = hypothetical seam; two adapters = real seam.**

## The loop

### Phase 0 — Frame the seam

Before designing anything:
- Read the project's conventions (`AGENTS.md` / `CLAUDE.md` / `patterns/`) and **find an existing similar module and skim it.** Match its shape; don't invent a new one.
- Name the module and the seam being designed, in the domain's own vocabulary.
- State the callers (other modules, HTTP handlers, tests) and what must be hidden inside vs. exposed.
- Apply the deletion test to anything that looks like a pass-through.

Ask the user one question at a time: *"What does this module need to do, who calls it, and what's the hardest constraint?"*

### Phase 1 — Draft the interface spec

Produce a **concise** TS-pseudocode spec — the artifact the user reviews. Include, and only include:

1. **Service interface** — the `Context.Service` / `Context.Tag` shape: method signatures with typed errors in the Effect channel. No bodies.
2. **Domain types at the seam** — branded scalars (`Schema.brand`) for IDs/slugs/urls; `Option` for modeled absence (never `null`/`undefined` internally).
3. **Tagged errors** — one `Schema.TaggedError` per failure mode, listed in each method's error channel.
4. **Call sites** — how a caller actually uses it: `const catalog = yield* LinkCatalog`.
5. **Call graph (MANDATORY — every design has one before implementation)** — production *and* test, top to bottom, showing each seam and the adapter behind it. This is the item most easily deferred into a "consolidation later" that never delivers, so treat it as non-optional: a spec without both call graphs is **incomplete and cannot be locked**. Draw it early, not at the end — it grounds the grilling in *who actually calls what* instead of abstract reasoning, and it's where you discover missing seams, wrong fibers, and adapters with no second implementation. Show the seam→adapter pair at each node so the "two adapters = real seam" check is concrete.
6. **Layer composition** — `Service.layer` (prod default), `Service.layerMemory` (in-memory test/dev adapter), `Service.layerFromEnv` (env-built) where needed. **No `Live` suffix.**

Keep it tight — signatures and wiring, not prose.

> **Don't bury the call graph in a six-item list and assume you'll add it when you "consolidate."** If you've drafted interfaces but not the prod + test call graph, the draft is half-done. Output the call graph in the *first* spec you present, and re-output it whenever a decision changes who calls what.

**Design it twice.** Your first shape is rarely the best. For any non-obvious or contested module, sketch 2–3 *radically different* interfaces (e.g. minimal method count vs. maximal flexibility vs. optimized-for-the-common-case) and compare them on **depth**: which hides the most behind the smallest interface, which is hardest to misuse, which forces the least awkward implementation. Present them, then converge — often the best design grafts ideas from more than one.

### Phase 2 — Lock the design (grilling loop)

This phase is where the value is — spend time here. Iterate until the user explicitly approves.

- **Grill the design relentlessly.** Walk each branch of the design tree, resolving dependencies between decisions one at a time. Ask questions **one at a time**, and for each give your recommended answer. If a question can be answered by reading the codebase, read it instead of asking.
- **Invite line-anchored feedback** on the spec and fold it in. After any substantive change, re-output the full revised spec so the user is always reviewing the current shape, not a diff in their head.
- **Pressure-test against the vocabulary:** Is each module deep? Is every seam justified by ≥2 adapters (one usually the in-memory test adapter)? Does each error channel name real, distinct failure modes? Would deleting any module concentrate complexity (good) or just move it (cut it)?
- **Record load-bearing decisions** — and the alternatives you rejected and why — so they aren't re-litigated.

**Lock gate — before asking for sign-off, confirm the spec contains:** the service interface(s), domain types, tagged errors, call sites, **both the production and test call graphs**, and layer composition. If any is missing — most often the call graphs — the design is not ready to lock. **Do not advance to Phase 3 until the user signs off on a complete spec.**

### Phase 3 — Tests against the interface

The locked interface is the test surface.
- Write behavior tests that exercise the **public interface only** — they should read like a specification ("operator can retarget an existing alias") and survive any internal refactor. Never test private functions or internal structure.
- **Vertical tracer-bullet slices:** one failing test → minimal code to pass → repeat. Never write all tests first (bulk tests verify imagined behavior and test shape, not behavior).
- For Effect codebases: `@effect/vitest`, `it.effect`, **`assert` not `expect`**; drive the seam under test through its `layerMemory` adapter — no `vi.mock` / `vi.spyOn`. Validate response shapes with the same boundary schema the handler uses.

### Phase 4 — Implement to green

Only now write implementation behind the seam. Minimal code per test. Refactor only while green, never while red. Run the project's typecheck and test commands and report results honestly — a command passes only if exit code 0 was directly observed; otherwise it is unverified, never "looks good."

## Hard rules

- No implementation before a locked design **and** failing tests against it.
- **Every design has a production *and* test call graph before implementation.** No call graphs ⇒ not locked ⇒ no code. Present them in the first spec, not at the end.
- The interface spec is signatures + wiring, never bodies, until Phase 2 is done.
- Prefer reverting and redesigning over patching a design the user pushed back on.
- Match the existing codebase's shape; reuse before inventing.
