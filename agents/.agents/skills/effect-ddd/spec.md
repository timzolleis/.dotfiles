# Spec

A spec is the module's design as pseudocode, in the order a reader builds it: the use cases it ships from the stories first, then the model, then one section per module along the call path. It holds decided design only.

Code, call trees, and `situation → outcome` lines carry it. Prose says only what code can't: why a name, what a choice costs, what was rejected. Lists of events, errors, finds, writes, and endpoints are commented code lines, not tables.

## Shape

~~~md
# Absences

Members record absences for themselves or related users. This PR ships draft, activate, and archive; reschedule and reassign are a later spec.

Host mapping: tenant is the organization (`OrganizationMemberMiddleware`); permissions via `hasPermission`; `DomainEvents` is the host's outbox.
Out of scope: UI, notifications.

## Use cases

Story: the absence story (where stories live is the host's fact). This spec ships:

| Use case | Rules |
|---|---|
| A member drafts an absence for themselves or a related user. | 1, 2 |
| A member archives an absence whose period has ended. | 2–5 |

## Affected use cases                               ← only when existing ones change

```text
A member sees their absences: archived ones no longer appear (absence rule 5).
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
  archive a draft (rule 3)                               → AbsenceStillDraftError (findActiveAbsenceById)
  archive someone else's, mayEditOthersAbsences (rule 2) → AbsenceArchivedEvent
  archive while the period is ongoing (rule 4)           → AbsenceOngoingError

## Model (`domain/absence-id.ts`, `domain/absence.ts`)

```ts
AbsenceId = prefixedId("abs").pipe(Schema.brand("AbsenceId"))

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
+ │  ├─ absence-id.ts               AbsenceId
+ │  ├─ absence.ts                  states, transitions
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
  active absence, period ended (rule 4)  → AbsenceArchivedEvent written
  already archived (rule 3)              → AbsenceAlreadyArchivedError

Cost: an absence that ends tonight stays active until someone archives it.
Rejected: archive on read when the period has ended: a read would write.
~~~

## Rules

- Use cases live in stories ([use-cases.md](use-cases.md)); the spec links them, lists the ones it ships with their rules, and cites rules as `(rule n)`, or `(absence rule n)` when it spans stories. A new or changed rule goes into the story first; the spec never restates it.
- Affected use cases: each existing use case or view whose behavior changes, with the rule that changes it.
- The intro maps the concept to the host: tenant, access, event publishing, Effect version. Conventions appear only where they differ from effect-ddd.
- One `###` per module along the call path: `Owns:` in one line, then signatures, call tree, Cases. Leave out what the module doesn't have.
- Cases are the module's test list ([testing.md](testing.md)); name the fixture in the heading.
- `Rejected:` only for an alternative that was weighed and a reader would propose again; `Cost:` only for a downside the design accepts. One line each, next to the decision.
- Every name greps to its definition. Ports owned by other modules are examples: name the method, not who implements it.
