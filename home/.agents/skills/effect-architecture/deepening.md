# Deepening

How to deepen a cluster of shallow modules into one deep module, given its dependencies. Uses the terms in [vocabulary.md](vocabulary.md).

## Dependency categories

Classify each dependency of the candidate. The category decides how the deepened module is tested across its seam.

| Category | Examples | In Effect | Tested with |
|---|---|---|---|
| **In-process** | pure computation, in-memory state | a policy or pure module, no Layer | direct calls through the new interface |
| **Local-substitutable** | Postgres, the filesystem | a Tag whose test Layer is a real local stand-in | the stand-in Layer in the test suite; the seam stays internal |
| **Remote but owned** | your own services across a network | a **port** Tag beside the operation that needs it, an HTTP or queue adapter Layer | an in-memory adapter Layer |
| **True external** | Stripe, an identity provider, a school-admin API | a port Tag, a production adapter Layer | `Layer.mock` at the port |

## Seam discipline

- **One adapter means a hypothetical seam; two adapters mean a real one.** Add a port only when production and test genuinely need different adapters.
- **Keep internal seams internal.** A deep module may use private seams for its own tests; do not expose them through its interface.
- **Raw technology types stop at the adapter.** Inner code sees domain types and the port's interface.
- **Composition roots choose adapters**; inner modules never pick a concrete implementation they do not own.

## Replace, don't layer

- Tests on the old shallow modules become waste once tests at the deepened interface exist. Delete them.
- Write new tests at the deepened module's interface; the interface is the test surface.
- Assert observable outcomes through the interface, not internal state. A test that must change when the implementation changes is testing past the interface.

## Recognizing a candidate

- The deletion test fails: deleting a module spreads no complexity, because it only forwards.
- One change regularly touches several modules that always change together.
- Callers repeat the same sequence of calls; the sequence wants to be one operation.
- Tests reach past an interface to reach the behavior they claim.
