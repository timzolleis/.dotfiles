# Vocabulary

The one place these terms are defined. Use them exactly; other skills use them without restating them.

## Design

- **Module** — anything with an interface and an implementation, at any scale: a function, a service, a package. _Avoid_: unit, component.
- **Interface** — everything a caller must know to use a module correctly: types, invariants, ordering, error modes, configuration, performance. _Avoid_: API, signature (both too narrow).
- **Implementation** — the body behind the interface.
- **Depth** — leverage at the interface: behavior a caller or test gets per unit of interface learned. **Deep** = much behavior behind a small interface; **shallow** = the interface is nearly as complex as the body.
- **Seam** — where behavior can be swapped without editing in place; in Effect, a Tag with more than one Layer. **Internal seams** serve a module's own tests; the **external seam** is its interface. _Avoid_: boundary.
- **Adapter** — a concrete thing that satisfies an interface at a seam (a Layer). Names a role, not a size.
- **Port** — an interface defined at a seam for a capability the module needs but does not own.
- **Leverage** — what callers gain from depth: more capability per unit of interface.
- **Locality** — what maintainers gain from depth: change, bugs, and verification concentrate in one place.
- **Deletion test** — imagine deleting the module. If complexity vanishes, it was a pass-through; if it reappears across callers, it earns its keep.
- **One adapter means a hypothetical seam; two adapters mean a real one.** Add a seam only when something varies across it.
- **Service test** — something is an Effect service only when it owns authority over a capability (persistence, I/O, time, randomness, configuration, resources), cohesive effect ordering reused across entry points, or real production/test variation. Otherwise it is a value or a pure module.
- **Authority seam** — the place that owns a capability; dependencies point inward to it, and raw technology types stop at its adapters.
- **Composition root** — where concrete Layers are selected and provided (`layer`, the app runtime). It holds no policy.

## Domain

- **Core type** — the type a module is about: an aggregate, or a type derived from it.
- **State** — one lifecycle member of a core type (`DraftAnnouncement`), discriminated by `status`.
- **Transition** — a named write from one state to the next (`publishAnnouncement(draft) → PublishedAnnouncement`).
- **Use case** — what an actor wants: a **command** (changes something) or a **question** (wants to know something).
- **Policy** — a pure function over domain types that answers one rule or computes one value.
- **Read model** — a question's answer: states plus context they do not own, named for the question (`AnnouncementInboxEntry`). Built by **composition**: it nests states rather than spreading their fields.

## Persistence and edges

- **Edge** — where data changes representation: HTTP, persistence, events, external systems. Every edge owns a **codec**, `Schema<DomainType, EdgeShape>`. A seam swaps behavior; an edge translates data. A repository is both.
- **Decoding ladder** — the least code each representation change allows; see [decoding.md](decoding.md).
- **Visibility predicate** — a shared `where` fragment that decides which rows exist for a caller (tenancy, recipient).
- **Race guard** — the source state in a transition's `where`; zero matched rows become the domain error.

## Rejected framings

- **"Boundary"** — overloaded with DDD's bounded context. Say **seam** or **edge**.
- **Depth as implementation lines per interface line** — rewards padding. Depth is leverage.
- **"A wrapper is architecture"** — a pass-through earns its keep only by hiding complexity, owning policy, or translating at an edge.
- **"Types are proof"** — rows, payloads, and messages lose their types at runtime. Decode them at the edge.
- **"Validation is enough"** — decoding returns the refined value, and that value travels inward.
- **"Future flexibility justifies an interface"** — see one adapter versus two.
- **"Mocks make tests isolated"** — module mocks isolate the wrong thing. Replace behavior at a real seam.
