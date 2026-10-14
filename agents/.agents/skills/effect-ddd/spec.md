# Spec

A spec is the module's design as pseudocode, in the order a reader builds it: use cases first, then the model, then one section per module along the call path. It holds decided design only.

Code, call trees, and `situation → outcome` lines carry it. Prose says only what code can't: why a name, what a choice costs, what was rejected. Lists of events, errors, finds, writes, and endpoints are commented code lines, not tables.

## Shape

~~~md
# Absences

Members record absences for themselves or related users. This PR ships draft, activate, and archive; reschedule and reassign are a later spec.

Host mapping: tenant is the organization (`OrganizationMemberMiddleware`); permissions via `hasPermission`; `DomainEvents` is the host's outbox.
Out of scope: UI, notifications.

## Use cases

```text
A member drafts an absence for themselves or a related user.
The creator activates their draft.
A member archives their active absence once its period has ended; with mayEditOthersAbsences, anyone's.
```

## Lifecycle                                        ← only when the core type has states

```text
  ┌───────┐ activate ┌────────┐ archive ┌──────────┐
  │ Draft │ ───────▶ │ Active │ ──────▶ │ Archived │
  └───────┘          └────────┘         └──────────┘
```

```ts
activateAbsence({ absence: DraftAbsence, actor, now }): Result<AbsenceActivatedEvent, NotAbsenceCreatorError>
archiveAbsence({ absence: ActiveAbsence, actor, now }):  Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
```

Cases
  archive a draft                              → AbsenceStillDraftError (findActiveAbsenceById)
  archive someone else's, mayEditOthersAbsences → AbsenceArchivedEvent
  archive while the period is ongoing          → AbsenceOngoingError

## Model (`domain/absence.ts`)

```ts
AbsenceId = prefixedId({ prefix: "abs", brand: "AbsenceId" })

const absenceFields = { absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId, period: Period, createdAt: Schema.DateTimeUtc }
DraftAbsence  = Schema.TaggedStruct("DraftAbsence",  { ...absenceFields })
ActiveAbsence = Schema.TaggedStruct("ActiveAbsence", { ...absenceFields, activatedAt: Schema.DateTimeUtc })
```

`Draft`, not `Pending`: nobody approves it; the creator activates it.
Rejected: one `Absence` with a `status` field: archive would accept a draft at compile time.

## Events and errors (`domain/absence-event.ts`, `domain/absence-error.ts`)

```ts
AbsenceDraftedEvent         { creatorId, assigneeId, period }   // createAbsence; occurredOn becomes createdAt
AbsenceArchivedEvent        {}                                  // archiveAbsence

AbsenceNotFoundError        { absenceId }                       // every find, AbsenceViews.getAbsenceById
AbsenceStillDraftError      { absenceId }                       // findActiveAbsenceById
```

## Table                                            ← only when persistence changes

```prisma
model Absence { … }
```

## Modules

```text
AbsenceController                   absence endpoints
├─ ArchiveAbsenceService            archive one active absence
│  └─ AbsenceRepository             narrowed finds, event → write → publish
└─ AbsenceViews                     AbsenceView reads, filtered by visibility
```

Files (`+` new, `~` changed):

```diff
  absence/
  ├─ domain/
+ │  ├─ absence.ts                  AbsenceId, states, transitions
…
```

### ArchiveAbsenceService.archiveAbsence (`application/archive-absence-service.ts`)
Owns: archiving one active absence.

```text
ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
├─ AbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })
│    : Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
├─ archiveAbsence({ absence, actor, now })
│    : Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
└─ AbsenceRepository.publishAbsenceEvent(event)
     : Effect<void, AbsenceChangedConcurrentlyError>
```

Cases (memory repository, TestClock)
  active absence, period ended   → AbsenceArchivedEvent written
  already archived               → AbsenceAlreadyArchivedError

Cost: an absence that ends tonight stays active until someone archives it.
Rejected: archive on read when the period has ended: a read would write.
~~~

## Rules

- The intro maps the concept to the host: tenant, access, event publishing, Effect version. Conventions appear only where they differ from effect-ddd.
- One `###` per module along the call path: `Owns:` in one line, then signatures, call tree, Cases. Leave out what the module doesn't have.
- Cases are the module's test list ([testing.md](testing.md)); name the fixture in the heading.
- `Rejected:` only for an alternative that was weighed and a reader would propose again; `Cost:` only for a downside the design accepts. One line each, next to the decision.
- Every name greps to its definition. Ports owned by other modules are examples: name the method, not who implements it.
