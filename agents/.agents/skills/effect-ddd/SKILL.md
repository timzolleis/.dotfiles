---
name: effect-ddd
description: How we design and build Effect 4 features — use cases, states, transitions, policies, actors, views, repositories, HTTP, tests. Use when designing, writing, or reviewing Effect TypeScript code.
---

# Effect DDD

The architecture for Effect 4 features, and how we design them together. Examples use one module, `absence` (draft → active → archived), in an organization-scoped system with permission keys. The core type, tenant, and access mechanism are examples: map them to the host's (the repository `AGENTS.md` names them) and leave out what the host doesn't have.

In design, the user decides; you bring the options and a recommendation. Settle what other decisions depend on first: use cases, then the lifecycle, then the policies, then names. A change too large to do inline gets a spec ([spec.md](spec.md)).

## Use cases first

Modeling the use cases is the core that makes everything else work. Analyze each one in domain language, who wants to do what, and shape every other component after the answers. With clean use cases the code is mechanical; a vague or merged one spreads into every layer as flags, branches, and generic updates.

Each question about a use case has one component that answers it:

```text
Who wants to do what?                    → use case, command, service       ArchiveAbsenceService
In which states may it happen?           → narrowing find, input state      findActiveAbsenceById, ActiveAbsence
Who may do it?                           → actor flag, who-acts policy      mayEditOthersAbsences
What else must hold? (time, values)      → policy, value constructor        cannotArchiveWhileOngoingPolicy, createPeriod
What must we load to check it?           → required input field             assigneeIsOrganizationMember
What can go wrong?                       → typed domain error, HTTP status  AbsenceOngoingError, 409
What is true afterwards?                 → event and its fields             AbsenceArchivedEvent
Who sees the result?                     → view, visibility rule            AbsenceView, absenceVisibilityFromReader
```

The answers are the use case's Cases, `situation → outcome` lines in domain words; each becomes a policy, an error, or a test. What a use case is and how to cut it: [use-cases.md](use-cases.md).

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
- A port is a `Context.Service` in the module that owns it; ports owned elsewhere sit in `shared/`.
- Spans: `Effect.fn("ArchiveAbsenceService.archiveAbsence")` on every service method. The span records a domain error with full context before the edge maps it.

## Naming

Names are truthful and greppable: the name alone says what a thing is or does, without its arguments, its return type, or the surrounding code filling the gap, and a search for it finds only it.

- Name the subject: `findActiveAbsenceById`, `publishAbsenceEvent`. `findById`, `publish`, `execute` match thousands of lines.
- An action starts with its verb: `archiveAbsence`, `generateAbsenceId`.
- A translation names its output and its input: `absenceVisibilityFromReader(reader)`, `absenceActorFromPermissions(…)`, `dateTimeUtcFromDate(date)`. `visibilityFor(reader)`, `mapTo`, `toHttpError`, `absenceFrom(row)` each leave one side to the arguments or the return type.
- Variables too: `absenceBeforeUpdate`, `previousPeriod`; not `before`, `prev`, `data`, `result`.
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
| Translation | `<output>From<input>` | `absenceActorFromPermissions`, `absenceHttpErrorFromAbsenceError` |
| Permission key | the host's format | `absences:update` |

## Layout

```text
lib/                                   cross-module helpers (prefixed-id.ts, with-optional-tag.ts, date-time-utc-from-date.ts, organization-member-middleware.ts)
shared/                                ports owned elsewhere (domain-events.ts, organization-members.ts, user-relationships.ts)
absence/
├─ domain/          absence-id.ts, absence.ts (states, inputs, transitions), period.ts, absence-actor.ts,
│                   absence-policy.ts, absence-event.ts, absence-error.ts, absence-repository.ts (port)
├─ application/     one <verb>-absence-service.ts per command
├─ view/            absence-views.ts (port + AbsenceView)
├─ infrastructure/  prisma-absence-repository.ts, prisma-absence-views.ts, absence-permissions.ts
└─ http/            absence-api.ts, absence-http-errors.ts, absence-controller.ts
```

## References

Read the reference for each part the change touches:

| Part | Reference |
|---|---|
| cutting use cases, commands, services, wiring | [use-cases.md](use-cases.md) |
| ids, states, time, transitions, events, domain errors | [model.md](model.md) |
| policies, where a rule lives | [policies.md](policies.md) |
| actor, reader, permissions, visibility, tenant scope | [access.md](access.md) |
| repository port and Prisma adapter | [repository.md](repository.md) |
| views and lists | [views.md](views.md) |
| routes, middleware, HTTP errors, idempotency | [http.md](http.md) |
| adding or judging a test | [testing.md](testing.md) |
| writing a spec | [spec.md](spec.md) |

## Call trees

A **call tree** is the one format for a call path, in discussion and in specs; prefer it, tables, and signatures over prose:

```diff
  ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
  ├─ AbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })
  │    : Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
- ├─ AbsenceRepository.updateAbsence(changes)
- │    : Effect<void>
+ ├─ archiveAbsence({ absence, actor, now })
+ │    : Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
  └─ AbsenceRepository.publishAbsenceEvent(event)
       : Effect<void, AbsenceChangedConcurrentlyError>
```

- The root is the entry point; each call is `Owner.method(args)`, indented under its caller with `├─`, `└─`, `│`.
- Each call to module code carries its return type after `:`, written as in the code: `Effect<A, E>`, `Result<A, E>`, or a bare type for a pure call that can't fail (`generateAbsenceId(): AbsenceId`). Inline when the line stays short; otherwise on the next line, under the call. Library calls (`prisma.…`) may omit it.
- `→` marks a branch or an outcome (`not found → AbsenceNotFoundError`, `→ assigneeIsOrganizationMember`); put the branch's calls under it.
- Current versus proposed: a ```` ```diff ```` block, so it renders colored; prefix removed lines with `-`, added with `+`, unchanged with a space; show only the subtree that changes. A tree without changes is ```` ```text ````.
- Name owners with the codebase's identifiers so each line greps to its definition.

## Effect APIs

Effect 4 only; Effect 3 APIs and memory are not sources. The source of truth is `~/.local/share/effect-repos/effect-v4` (start at `LLMS.md` and `ai-docs/src`; Schema in `packages/effect/SCHEMA.md`, HttpApi in `HTTPAPI.md`).
