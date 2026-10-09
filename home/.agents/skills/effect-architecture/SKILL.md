---
name: effect-architecture
description: How a feature is built with Effect — domain types, repositories, services, HTTP edges, decoding, naming, and tests. Use when writing, reviewing, or designing Effect TypeScript code, or when another skill needs the architecture vocabulary.
---

# Effect architecture

The portable concept for Effect features. A repository's `AGENTS.md` adds facts (stack, commands, layout, legacy); it departs from this concept only through an exception it states explicitly.

Terms in **bold** are defined in [vocabulary.md](vocabulary.md).

## Version

The references hold version-neutral rules; their code lives in `examples/v<major>/`, where `<major>` is the installed `effect` major (`node_modules/effect/package.json`). Read only your version's examples.

## The feature call tree

```text
Handler                                     HTTP edge: the request codec decodes input
├─ Policy.canX(organizationId)              → AuthorizedOrganizationId | ForbiddenError
├─ question → Repository.find / list        → state or read model
│             handler returns the domain value; the *Response codec encodes it
└─ command  → Service.useCase
              ├─ Repository read            → state
              ├─ decide                     Match on status, call policies (pure)
              ├─ Repository.transition      guarded partial write → next state | domain error
              └─ side effects               events, other features
domain error → *HttpError codec encodes it with its status
```

## Module kinds

| Kind | Owns | Reference |
|---|---|---|
| Domain | states, read models, errors, policies of one **core type** | [domain.md](domain.md) |
| Repository | the persistence **adapter** for one core type | [repository.md](repository.md) |
| Service | the **use cases** whose subject is one core type | [service.md](service.md) |
| HTTP edge | handlers, `*Response`, `*HttpError`, request codecs | [http-edge.md](http-edge.md) |
| Codec | one representation change at an **edge** | [decoding.md](decoding.md) |

Read the reference for every module kind the change touches. Also read [naming.md](naming.md) when naming anything, [testing.md](testing.md) before adding or reviewing a test, and [deepening.md](deepening.md) when merging shallow modules.

## Deciding rules

1. **One module, one core type.** A module that starts defining or working on another type is a tell to split it.
2. **Decisions live in services and policies.** Repositories adapt, edges translate, handlers wire.
3. **Illegal states are unrepresentable.** Lifecycle states form a union; a transition accepts only its source state.
4. **The domain knows no transport.** No status codes, wire shapes, tables, or Prisma types in domain modules.
5. **Every edge is a codec**, `Schema<DomainType, EdgeShape>`. Services and handlers see domain types only.
6. **Each fact is stated once, or restated where `tsc` checks the restatement** (a `*Response` field against the domain type).
7. **Infrastructure failures are defects** (`Effect.orDie`) unless a caller can act on them.

## Effect code

- Effect-only: no `throw`, `new Error`, Promise-returning domain APIs, or Zod.
- Match discriminated unions with `Match.discriminatorsExhaustive('<discriminator>')`, not `switch`.
- An impossible typed failure dies with its value: `Effect.catchTag('XError', (error) => Effect.die(error))`.
- A wrapping error keeps its own message ([naming.md](naming.md)) and carries the original as `cause`; never interpolate the cause into the message.
- Import from module subpaths (`effect/Effect`, `effect/Schema`), never the root barrel. `pipe` comes from `effect/Function`.
- Verify Effect APIs against the installed version's source before using them; never guess.

## Less code

Every line is read and maintained; write the least the change needs.

- Comment only a constraint the code cannot show (units, ordering, a non-obvious why). No history ("moved from", "copied from"), no restated names, no narration of the change.
- Use what Effect and Schema already provide (`DateTime`, `Option`, Schema transforms and filters, `Effect.all` with `mode: 'validate'`) before writing a helper. A new helper, type, or wrapper must pass the **deletion test**.
- Extend the owning service, schema, or file before creating a new one. A new file needs a reason: a new module, or a file too large to read.
- Models (states, read models) are `Schema.Struct`, not `Schema.Class`. Absence inside the domain is `Option`; `null` exists only in edge shapes.
- Let inference work. Annotate a type only where it states a contract: an interface or an exported signature.

## Readable code

- A file reads top-down: what a reader opens it for first (the interface, the main use case), details below.
- A function stays at one level of abstraction. Return early instead of nesting; take no boolean flag parameters.
- `Effect.fn` or `Effect.gen` for sequences, `pipe` for one or two combinators; no `pipe` chains inside a generator.
- A file holds one module: the things that change together. Split only when a part gains another reader or another reason to change.

## Refactors

- **Touched code is new code.** Code a change moves, renames, extends, or rewrites meets this guidance in full; only code the diff leaves alone keeps its old style. "Moved unchanged" or "pre-existing" never justifies keeping a touched line as it was.
- **Old code is evidence of behavior, never of shape.** Read it for its cases, edge behavior, and wire contracts; record them as `Cases` (or temporary tests); write the target from the spec and this guidance; delete the old code. No line is carried over.
