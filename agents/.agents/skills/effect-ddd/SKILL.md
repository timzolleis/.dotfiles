---
name: effect-ddd
description: How we design and build Effect 4 features — use cases, states, transitions, rules, actors, views, repositories, HTTP, tests. Use when designing, writing, or reviewing Effect TypeScript code.
---

# Effect DDD

The architecture for Effect 4 features, and how we design them together. Examples use one module, `absence` (draft → active → archived), in an organization-scoped system with permission keys. The core type, tenant, and access mechanism are examples: map them to the host's (the repository `AGENTS.md` names them) and leave out what the host doesn't have.

## Designing with the user

Bring the options and a recommendation, then let the user choose. Settle what other decisions depend on first: use cases, then the lifecycle, then the rules, then names. A change too large to do inline gets a spec ([spec.md](spec.md)).

A good turn: "Archive needs the period to have ended. Option A: a rule on archive (`cannotArchiveWhileOngoingRule`), 409 while ongoing. Option B: a nightly job archives ended absences. I recommend A: B needs a system actor, which is still open. Which do you want?"

## Use cases first

Modeling the use cases is the core that makes everything else work. Analyze each one in domain language, who wants to do what, together with the user: they know the domain and have the say. Shape every other component after the answers. With clean use cases the code is mechanical: easy to read, and every line traces back to a use case. A vague or merged one spreads into every layer as flags, branches, and generic updates.

Each question about a use case has one component that answers it:

```text
Who wants to do what?                    → use case, command, service       ArchiveAbsenceService
In which states may it happen?           → narrowing find, input state      findActiveAbsenceById, ActiveAbsence
Who may do it?                           → actor flag, who-acts rule        mayEditOthersAbsences
What else must hold? (time, values)      → rule, value constructor          cannotArchiveWhileOngoingRule, createPeriod
What must we load to check it?           → required input field             assigneeIsOrganizationMember
What can go wrong?                       → typed domain error, HTTP status  AbsenceOngoingError, 409
What is true afterwards?                 → event and its fields             AbsenceArchivedEvent
Who sees the result?                     → view, visibility rule            AbsenceView, absenceVisibilityFromReader
```

The answers are the use case's Cases, `situation → outcome` lines in domain words; each becomes a rule, an error, or a test. What a use case is and how to cut it: [use-cases.md](use-cases.md).

## Deciding rules

1. **The domain is pure**: states, transitions, rules, events, errors. No services, no I/O, no transport.
2. **One schema per state.** A transition accepts only the states that allow it, so a wrong state doesn't compile.
3. **A transition is a pure function**: input → `Result<Event, …errors>`. A use case only loads, calls the transition, and publishes the event.
4. **With permissions, each is a flag on the actor**; a rule decides. No permission gates. A read rule filters by visibility; it never rejects. Without an access model the actor is `{ userId }` ([access.md](access.md)).
5. **The domain stays truthful.** Retries and idempotency are softened at the HTTP edge with `catchTag`.
6. **Decode at every edge**, with no branching or `Effect.die` before the decode.
7. **A client-actionable failure is a typed error**; corrupt data and infrastructure failures die.
8. **With tenants, scope is checked once at the edge** and enforced by the repository's and views' `where`; the domain never sees it.
9. **Leave out what the host repository solves**: event delivery, outbox, scaling.

## Conventions

- Invent nothing the rule doesn't need: no wrapper types, helper abstractions, or combinators beyond the `lib/` helpers this skill defines (`prefixedId`, `withOptionalTag`, `dateTimeUtcFromDate`, `matchTag`). When a name or type has no truthful home, reshape the design instead.
- A function with more than one argument takes one object (`archiveAbsence({ absence, actor, now })`); a single argument stays positional (`publishAbsenceEvent(event)`).
- Data is `Schema.Struct` / `Schema.TaggedStruct` plus `type X = typeof X.Type`; values can be spread. Errors are the only classes. No `Schema.Class` for data: encoding checks the instance, so a spread copy fails with `InvalidType`.
- Behavior is named exports imported by name; no namespace imports.
- Every signature writes out its errors; never hide them behind a union alias.
- An error is an `Effect`: return or `yield*` `new X(…)`, never `Effect.fail(new X(…))`. Domain code returns a `Result`, so it uses `Result.fail(new X(…))`.
- Branch on a tag with `Match.valueTags` (exhaustive); never `_tag ===` or ternary chains.
- When the result type must follow the input's tag, use `matchTag` ([repository.md](repository.md)). `Match` returns the union of all branches, which a generic signature only accepts with a cast. Never hand-write the mapped type or cast.
- Time is `DateTime.Utc` everywhere except at Prisma ([model.md](model.md)).
- A port is a `Context.Service` in the module that owns it; ports owned elsewhere sit in `shared/`.
- Across a boundary (HTTP → command, port → Prisma, host type → adapter), name every field: `{ from: payload.from, to: payload.to }`, never `...payload`. A spread lets a field added on one side flow into the other unchecked. Spreads stay inside one layer (`...absenceFields`).
- Spans: `Effect.fn("ArchiveAbsenceService.archiveAbsence")` on every service method. The span records a domain error with full context before the edge maps it.

## Layout

```text
lib/          cross-module helpers
shared/       ports and ids owned by other modules
absence/      one folder per layer: domain/, application/, view/, infrastructure/, http/
```

## One request, end to end

Archiving an absence passes every layer once:

```text
AbsenceController.archiveAbsence({ params })
├─ absenceActorFromPermissions({ userId, organizationId, permissions, relatedUserIds })
├─ ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
│  ├─ AbsenceRepository.findActiveAbsenceById(…)
│  ├─ archiveAbsence({ absence, actor, now })
│  │  └─ checkRules(archiveAbsenceRules, input)
│  └─ AbsenceRepository.publishAbsenceEvent(event)
├─ AbsenceViews.getAbsenceById({ organizationId, visibility, absenceId })
└─ any domain error → absenceHttpErrorFromAbsenceError(error)
```

## Read next

| Situation | Read |
|---|---|
| Cutting use cases; writing a command or a service | [use-cases.md](use-cases.md) |
| Adding an id, state, value object, transition, event, or domain error; anything with time | [model.md](model.md) |
| Adding a rule, or deciding where a constraint lives | [rules.md](rules.md) |
| Permissions, the actor, who sees what, tenant scope | [access.md](access.md) |
| Loading state for a transition or storing its event; `matchTag` | [repository.md](repository.md) |
| A read for a client: a get, a list, a filter | [views.md](views.md) |
| An endpoint, middleware, HTTP error, controller, or retry | [http.md](http.md) |
| Naming anything | [naming.md](naming.md) |
| Writing, keeping, or judging a test | [testing.md](testing.md) |
| A change too large to do inline: writing a spec | [spec.md](spec.md) |

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
