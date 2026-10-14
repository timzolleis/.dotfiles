---
name: effect-ddd
description: How we design and build Effect 4 features — states, transitions, policies, actors, reads, repositories, HTTP, tests. Use when designing, writing, or reviewing Effect TypeScript code.
---

# Effect DDD

The architecture for Effect 4 features, and how we design them together. Examples use one module, `absence` (draft → active → archived), in an organization-scoped system with permission keys. The core type, tenant, and access mechanism are examples: map them to the host's (the repository `AGENTS.md` names them) and leave out what the host doesn't have.

In design, the user decides; you bring the options and a recommendation. Settle what other decisions depend on first: the lifecycle before the policies, where a rule lives before its name. A change too large to do inline gets a spec ([spec.md](spec.md)).

## Deciding rules

1. **The domain is pure**: states, transitions, policies, events, errors. No services, no I/O, no transport.
2. **One schema per state.** A transition accepts only the states that allow it, so a wrong state doesn't compile.
3. **A transition is a pure function**: input → `Result<Event, …errors>`. A use case only loads, calls the transition, and publishes the event.
4. **With permissions, each is a flag on the actor**; a policy decides. No permission gates. A read rule filters by visibility; it never rejects. Without an access model the actor is `{ userId }` ([access.md](access.md)).
5. **The domain stays truthful.** Retries and idempotency are softened at the HTTP edge with `catchTag`.
6. **Decode at every edge**, with no branching or `Effect.die` before the decode.
7. **A client-actionable failure is a typed error**; corrupt data and infrastructure failures die.
8. **With tenants, scope is checked once at the edge** and enforced by the repository's and views' `where`; the domain never sees it.
9. **Leave out what the host repository solves**: event delivery, outbox, scaling.

## Conventions

- Invent nothing the rule doesn't need: no wrapper types, helper abstractions, or combinators. When a name or type has no truthful home, reshape the design instead.
- A function with more than one argument takes one object (`archiveAbsence({ absence, actor, now })`); a single argument stays positional (`publishAbsenceEvent(event)`).
- Data is `Schema.Struct` / `Schema.TaggedStruct` plus `type X = typeof X.Type`; values can be spread. Errors are the only classes. No `Schema.Class` for data: encoding checks the instance, so a spread copy fails with `InvalidType`.
- Behavior is named exports imported by name; no namespace imports.
- Every signature writes out its errors; never hide them behind a union alias.
- Branch on a tag with `Match.valueTags` (exhaustive); never `_tag ===` or ternary chains.
- Time is `DateTime.Utc` everywhere except at Prisma ([model.md](model.md)).
- Spans: `Effect.fn("ArchiveAbsenceService.archiveAbsence")`.

## Naming

- Every function and method names its subject: `getAbsenceById`, `publishAbsenceEvent`; never `getById`, `publish`, `execute`.
- Verb first; no names ending in `For` (`absenceVisibilityFor(reader)` → `createAbsenceVisibilityForReader(reader)`).
- Files are kebab-case (`absence-policy.ts`); identifiers are camelCase / PascalCase.

| Thing | Pattern | Example |
|---|---|---|
| State | `<Phase><Type>` | `DraftAbsence` |
| States a transition accepts | what they allow | `EditableAbsence` |
| Transition, its input | `<verb><Type>`, `<Verb><Type>Input` | `archiveAbsence`, `ArchiveAbsenceInput` |
| Policy type, list | `<Verb><Type>Policy`, `<verb><Type>Policies` | `ArchiveAbsencePolicy`, `archiveAbsencePolicies` |
| Single policy | the rule as a sentence + `Policy`, without the subject | `cannotArchiveWhileOngoingPolicy` |
| Event | `<Type><PastTense>Event` | `AbsenceArchivedEvent` |
| Domain error | `<Fact>Error`; *still* = not yet, *already* = past it | `AbsenceStillDraftError` |
| HTTP error | domain error name + `Http` | `AbsenceStillDraftHttpError` |
| Actor, flag | `<Type>Actor`, `may<Verb>…` | `AbsenceActor`, `mayEditOthersAbsences` |
| Repository find | `find<State><Type>ById` | `findActiveAbsenceById` |
| View read | `get…` / `list…` | `getAbsenceById`, `listAbsences` |
| Use case, command | `<Verb><Type>Service`, `<Verb><Type>Command` | `ArchiveAbsenceService`, `ArchiveAbsenceCommand` |
| Permission key | the host's format | `absences:update` |

## Layout

```text
lib/                                   cross-module helpers (with-optional-tag.ts, date-time-utc-from-date.ts, organization-member-middleware.ts)
shared/                                ports owned elsewhere (domain-events.ts, organization-members.ts, user-relationships.ts)
absence/
├─ domain/          absence.ts (id, states, inputs, transitions), period.ts, absence-actor.ts, absence-policy.ts,
│                   absence-event.ts, absence-error.ts, absence-repository.ts (port)
├─ application/     one <verb>-absence-service.ts per command
├─ view/            absence-views.ts (port + AbsenceView)
├─ infrastructure/  prisma-absence-repository.ts, prisma-absence-views.ts
└─ http/            absence-api.ts, absence-http-errors.ts, absence-permissions.ts, absence-controller.ts
```

## References

Read the reference for each part the change touches:

| Part | Reference |
|---|---|
| ids, states, time, transitions, events, domain errors | [model.md](model.md) |
| policies, where a rule lives | [policies.md](policies.md) |
| actor, reader, permissions, visibility, organization scope | [access.md](access.md) |
| use cases, commands, ports, wiring | [use-cases.md](use-cases.md) |
| repository port and Prisma adapter | [repository.md](repository.md) |
| views and lists | [reads.md](reads.md) |
| routes, middleware, HTTP errors, idempotency | [http.md](http.md) |
| adding or judging a test | [testing.md](testing.md) |
| writing a spec | [spec.md](spec.md) |

## Call trees

A **call tree** is the one format for a call path, in discussion and in specs; prefer it, tables, and signatures over prose:

```text
  ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
  ├─ AbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })   → AbsenceNotFoundError | AbsenceStillDraftError
- ├─ AbsenceRepository.updateAbsence(changes)
+ ├─ archiveAbsence({ absence, actor, now })                                     → NotAllowedToEditAbsenceError | AbsenceOngoingError
  └─ AbsenceRepository.publishAbsenceEvent(AbsenceArchivedEvent)                 → AbsenceChangedConcurrentlyError
```

- The root is the entry point; each line is one call as `Owner.method(args)`, indented under its caller with `├─`, `└─`, `│`.
- Mark a decision, effect, or typed failure after `→`; put the branch's calls under it.
- Current versus proposed: prefix removed lines with `-`, added with `+`, unchanged with a space; show only the subtree that changes.
- Name owners with the codebase's identifiers so each line greps to its definition.

## Effect APIs

Effect 4 only; Effect 3 APIs and memory are not sources. The source of truth is the project's installed `effect`, then `~/.local/share/effect-repos/effect-v4` (start at `LLMS.md` and `ai-docs/src`; Schema in `packages/effect/SCHEMA.md`, HttpApi in `HTTPAPI.md`).
