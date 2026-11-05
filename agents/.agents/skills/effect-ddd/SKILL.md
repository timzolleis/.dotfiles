---
name: effect-ddd
description: How we design and build Effect 4 features — use cases, states, transitions, rules, actors, views, repositories, HTTP, tests. Use when designing, writing, or reviewing Effect TypeScript code.
---

# Effect DDD

The architecture for Effect 4 features, and how we design them together. Examples use one module, `absence` (draft → active → archived), in an organization-scoped system with permission keys. The core type, tenant, and access mechanism are examples: map them to the host's (the repository `AGENTS.md` names them) and leave out what the host doesn't have.

## Designing with the user

Bring the options and a recommendation, then let the user choose. Settle what other decisions depend on first: use cases, then the lifecycle, then the rules, then names. A change too large to do inline is first a change to the area's story ([story.md](story.md)); its signatures and call trees are shown in the conversation, not written into the story. Build nothing until the user approves it: code written before approval gets rebuilt when they change the design.

A story comes out of exploring with the user: talk the area through, options and recommendations, until they say to write it down. Then condense what was settled into the story ([story.md](story.md)) in one go: nothing they didn't settle, their open points in `## Open`, their reasons as the rules' why. Their edits afterwards are diffs on the file. Never hand the exploring to a sub-agent: the user's answers are its input. Sub-agents build from what was agreed.

Always ask the user; never settle an open question alone. A brief that marks decisions as made settles only those: every question it leaves open (a port's shape, an event's fields, a test seam) goes to the user with the options and a recommendation. Without a channel to ask, stop and ask in the reply rather than pick and report.

A rare edge case that would make the code much harder is never dropped silently. Name the case, who notices it and how often, and what handling it costs, then ask. The answer becomes a rule, or a `Cost:` line in the story's decisions.

When two modules solve the same thing differently, this skill decides which one drifted: align that one to it, never the newer module to the older.

A good turn: "Archive needs the period to have ended. Option A: a rule on archive (`cannotArchiveWhileOngoingRule`), 409 while ongoing. Option B: a nightly job archives ended absences. I recommend A: B needs a system actor, which is still open. Which do you want?"

## Use cases first

Modeling the use cases is the core that makes everything else work. Analyze each one in domain language, who wants to do what, together with the user: they know the domain and have the say. Shape every other component after the answers. With clean use cases the code is mechanical: easy to read, and every line traces back to a use case. A vague or merged one spreads into every layer as flags, branches, and generic updates.

Each question about a use case has a domain answer, and one component it lands in:

| Question | Domain answer | Lands in |
|---|---|---|
| Who wants to do what? | intent: "a member archives an absence whose period has ended" | use case, command, service: `ArchiveAbsenceService` |
| What does the domain decide on? | the unit a decision falls on: "each absence is reported, corrected, withdrawn on its own" | the core type and its states: `ReportedAbsence` ([model.md](model.md)) |
| In which states may it happen? | constraint: "only an active absence" | narrowing find, input state: `findActiveAbsenceById`, `ActiveAbsence` |
| Who may do it? | constraint: "the creator; with permission, anyone" | actor flag, who-acts rule: `mayEditOthersAbsences` |
| What else must hold? (time, values) | constraint: "the period has ended" | rule, value constructor: `cannotArchiveWhileOngoingRule`, `createPeriod` |
| What must we load to check it? | a fact a constraint names: "the assignee is a member" | required input field: `assigneeIsOrganizationMember` |
| What can go wrong? | each refusal: "still ongoing" | typed domain error, HTTP status: `AbsenceOngoingError`, 409 |
| What is true afterwards? | outcome: "the absence is archived" | event and its fields: `AbsenceArchivedEvent` |
| Who sees the result? | "involved members; with permission, everyone" | view, visibility rule: `AbsenceView`, `absenceVisibilityFromReader` |

Answer the domain column first, with the user, before any type name; it holds in any codebase. The last column is this architecture's; map it to the host's components. The answers form the story: intent, use cases, numbered rules, each with its examples, tests and code ([story.md](story.md)).

## Deciding rules

1. **The domain is pure**: states, transitions, rules, events, errors. No services, no I/O, no transport.
2. **One schema per state.** A transition accepts only the states that allow it, so a wrong state doesn't compile.
3. **A transition is a pure function**: input → `Result<Event, …errors>`; `evolve` applies the event to the state ([model.md](model.md)). A use case only loads, calls the transition, evolves, and saves. The repository stores the evolved state and never interprets an event ([repository.md](repository.md)).
4. **With permissions, each is a flag on the actor.** A flag that decides alone, without state or ownership, is a gate: the use case checks it first, before any find, and fails with the module's `NotAllowedTo…Error`. A flag the decision combines with state or ownership ("the creator, or anyone permitted") is a rule in the transition's list, so a gate never turns "creator OR permitted" into "creator AND permitted". A read rule filters by visibility; it never rejects. Without an access model there is no actor until a rule or a reader of the event needs the user ([access.md](access.md)).
5. **The domain stays truthful.** Retries and idempotency are softened at the HTTP edge with `catchTag`.
6. **Decode at every edge**, with no branching or `Effect.die` before the decode.
7. **A client-actionable failure is a typed error**; corrupt data and infrastructure failures die.
8. **With tenants, scope is checked once at the edge** and enforced by the repository's and views' `where`; the domain never sees it.
9. **Leave out what the host repository solves**: event delivery, outbox, scaling.

## Conventions

- Invent nothing the rule doesn't need: no wrapper types, helper abstractions, or combinators beyond the `lib/` helpers this skill defines (`prefixedId`, `checkRules`, `withOptionalTag`, `dateTimeUtcFromDate`, `matchTag`, `messageWithDefault`). When a name or type has no truthful home, reshape the design instead.
- Copy the example's shape, never its weight. `absence` has tenants, creators, related users, and five flags; a host with one boolean role has none of that. Each part arrives with the first reader that needs it, and a part nothing reads today is left out:

  | Part | Exists once |
  |---|---|
  | actor flag | a rule reads it, and two actors the host can build differ on it; flags that always agree are one flag |
  | second actor type in a module | a core type's flags differ from the module's other core types' |
  | rule type and list | a transition has two rules; one rule is called directly ([rules.md](rules.md)) |
  | `Result` on a transition | the transition has a rule; without one it returns the event |
  | visibility | two readers see different rows ([access.md](access.md)) |
  | `actor`, `actorId` | a rule or a reader of the event needs the user ([access.md](access.md)) |
- Data is `Schema.Struct` / `Schema.TaggedStruct` plus `type X = typeof X.Type`; values can be spread. Errors are the only classes. No `Schema.Class` for data: encoding checks the instance, so a spread copy fails with `InvalidType`.
- Every signature writes out its errors; never hide them behind a union alias.
- An error is an `Effect`: return or `yield*` `new X(…)`, never `Effect.fail(new X(…))`. Domain code returns a `Result`, so it uses `Result.fail(new X(…))`.
- Branch on a tag with `Match.valueTags` (exhaustive); never `_tag ===` or ternary chains.
- When the result type must follow the input's tag, use `matchTag` ([http.md](http.md), the HTTP error mapper). `Match` returns the union of all branches, which a generic signature only accepts with a cast. Never hand-write the mapped type or cast.
- Make illegal states unrepresentable; make illegal calls die. A state the types allow but the domain doesn't is a wrong state design; a call that only a bug can make (`evolve` yielding nothing from nothing) earns one `Effect.die`, not overloads ([repository.md](repository.md)).
- Time is `DateTime.Utc` everywhere except at Prisma ([model.md](model.md)).
- A port is a `Context.Service` in the module that owns it; ports owned elsewhere sit in `shared/`. Ids are imported from the module that owns them, never copied into `shared/`: an id is a stable branded value, and a second path to it only drifts.
- Spans: `Effect.fn("ArchiveAbsenceService.archiveAbsence")` on every service method. The span records a domain error with full context before the edge maps it.

## Layout

```text
lib/          cross-module helpers
shared/       ports owned by other modules
absence/      one folder per layer: domain/, application/, view/, infrastructure/, http/
```

A module is one core type: its id, states, transitions, rules, events, errors, and repository. A second core type with its own id and events (a membership inside an organization) is its own module, even when it exists only inside the first; what crosses between them is an event and a policy, never a second write in the first's repository. A host with several bounded contexts nests modules under their context (`administration/absence/`), names the contexts and their dependencies in its `CONTEXT.md`, and lets a context reach another only through a port in its own `shared/`.

Imports point inward. `domain/` imports only `domain/`, `lib/` and `shared/`; `application/` and `view/` import those too, never each other. `infrastructure/` imports any layer but `http/`, and `http/` imports any layer. Only the host's wiring imports `http/`. A module reaches another only through a port in `shared/`, or another module's id.

Every component carries Effect's live variant: `layerNoDeps` holds the logic and needs its ports; `layer` is `layerNoDeps.pipe(Layer.provide(…))` with the module's default adapters, so the host composes almost nothing. That `Layer.provide` line is the one place `application/` and `view/` may import `infrastructure/`; everything above it sees only ports, and tests build from `layerNoDeps` with fakes.

## One request, end to end

Archiving an absence passes every layer once:

```text
AbsenceController.archiveAbsence({ params })
├─ absenceActorFromPermissions({ userId, organizationId, permissions, relatedUserIds })
├─ ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
│  ├─ AbsenceRepository.findActiveAbsenceById(…)
│  ├─ archiveAbsence({ absence, actor, now })
│  │  └─ checkRules(archiveAbsenceRules, input)
│  ├─ evolveAbsence({ absence: before, event })
│  └─ AbsenceRepository.saveAbsence({ event, before, after })
├─ AbsenceViews.getAbsenceById({ organizationId, visibility, absenceId })
└─ any domain error → absenceHttpErrorFromAbsenceError(error)
```

## Delivery

The story is the plan and the only document; there are no change files or specs beside it ([story.md](story.md#the-pr)). Before any code, the story is cut into slices with the user, one PR each, stacked. A slice is logically complete: a reviewer reads it as one behavior end to end (enable and disable together, not enable alone), and it fits one review sitting. The module's first slice holds its shape: the core type, the use cases that belong together, a view, the host's wiring. The exhaustive matches (`evolve` over events, `absenceRowFromState` over states, the HTTP error mapper over errors) make a slice safe: a use case that misses a layer doesn't compile.

A PR that adds a part no use case in it reads (an actor flag, a find, an error) is early; move the part to the slice with its reader.

## Read next

| Situation | Read |
|---|---|
| Cutting use cases; writing a command or a service | [use-cases.md](use-cases.md) |
| Adding an id, state, value object, transition, event, or domain error; anything with time | [model.md](model.md) |
| Adding a rule, or deciding where a constraint lives | [rules.md](rules.md) |
| Permissions, the actor, who sees what, tenant scope | [access.md](access.md) |
| Loading state for a transition or saving the evolved state | [repository.md](repository.md) |
| A read for a client: a get, a list, a filter | [views.md](views.md) |
| An endpoint, middleware, HTTP error, controller, or retry | [http.md](http.md) |
| Web code that shows, edits, or checks domain values | [client.md](client.md) |
| Naming anything | [naming.md](naming.md) |
| Writing, keeping, or judging a test | [testing.md](testing.md) |
| Writing or changing a story | [story.md](story.md) |

## Call trees

A **call tree** is the one format for a call path, in discussion and in a PR; prefer it, tables, and signatures over prose:

```diff
  ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
  ├─ AbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })
  │    : Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
- ├─ AbsenceRepository.updateAbsence(changes)
- │    : Effect<void>
+ ├─ archiveAbsence({ absence, actor, now })
+ │    : Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
+ ├─ evolveAbsence({ absence: before, event }): Option<Absence>
  └─ AbsenceRepository.saveAbsence({ event, before, after })
       : Effect<void, AbsenceChangedConcurrentlyError>
```

- The root is the entry point; each call is `Owner.method(args)`, indented under its caller with `├─`, `└─`, `│`.
- Each call to module code carries its return type after `:`, written as in the code: `Effect<A, E>`, `Result<A, E>`, or a bare type for a pure call that can't fail (`generateAbsenceId(): AbsenceId`). Inline when the line stays short; otherwise on the next line, under the call. Library calls (`prisma.…`) may omit it.
- `→` marks a branch or an outcome (`not found → AbsenceNotFoundError`, `→ assigneeIsOrganizationMember`); put the branch's calls under it.
- Current versus proposed: a ```` ```diff ```` block, so it renders colored; prefix removed lines with `-`, added with `+`, unchanged with a space; show only the subtree that changes. A tree without changes is ```` ```text ````.
- Name owners with the codebase's identifiers so each line greps to its definition.

## Effect APIs

Effect 4 only; Effect 3 APIs and memory are not sources. The source of truth is `~/.local/share/effect-repos/effect-v4` (start at `LLMS.md` and `ai-docs/src`; Schema in `packages/effect/SCHEMA.md`, HttpApi in `HTTPAPI.md`).
