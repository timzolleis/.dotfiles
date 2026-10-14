# Model

States, ids, time, transitions, events, and domain errors of one core type. Pure: no services, no I/O.

## Ids

The domain owns its id format: a prefixed cuid2, not a UUID.

```ts
AbsenceId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^abs_[a-z][a-z0-9]{23}$/)),
  Schema.brand("AbsenceId"))
generateAbsenceId = (): AbsenceId => AbsenceId.make(`abs_${createId()}`)   // @paralleldrive/cuid2
```

- Ids of other modules (`OrganizationId`, `UserId`) are their brands; reference them, never redefine them.
- Identity is hybrid: the client may send the id (optimistic UI, idempotent retries); otherwise the create use case calls `generateAbsenceId()`. A taken id → `AbsenceAlreadyExistsError`. No `nextIdentity()` on the repository.

## States

```ts
const absenceFields = { absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId,
                        period: Period, createdAt: Schema.DateTimeUtc }

DraftAbsence    = Schema.TaggedStruct("DraftAbsence", { ...absenceFields })
ActiveAbsence   = Schema.TaggedStruct("ActiveAbsence", { ...absenceFields, activatedAt: Schema.DateTimeUtc })
ArchivedAbsence = Schema.TaggedStruct("ArchivedAbsence", { ...absenceFields, activatedAt: Schema.DateTimeUtc, archivedAt: Schema.DateTimeUtc })

type Absence         = DraftAbsence | ActiveAbsence | ArchivedAbsence   // any state; nothing decodes to it
type EditableAbsence = DraftAbsence | ActiveAbsence                     // the states reschedule, reassign, delete accept
```

- One `Schema.TaggedStruct` per state, with exactly the fields that state guarantees.
- Name a union of states after what it allows (`EditableAbsence`).

## Value objects

A constructor returns a `Result`; a question about the value is a plain function.

```ts
createPeriod({ from, to })         → Result<Period, InvalidPeriodError>   // DateTime.isLessThan(from, to)
isPeriodOngoingAt({ period, now }) → boolean                              // from <= now < to
```

## Time

- `DateTime.Utc` (`Schema.DateTimeUtc`) in states, events, errors, views, and HTTP. `Date` exists only at Prisma ([repository.md](repository.md)).
- `Utc`, not `Zoned`, until a rule depends on local calendar days.
- `now` comes from `DateTime.now` in the use case (it reads `Clock`, so tests use `TestClock`). Clients never send it.
- Compare with `DateTime.isLessThan` and friends, never `<` or `===`. Write intervals out (`from <= now < to`); `DateTime.between` includes both ends.
- An instant that a policy checks and an error reports is one function: `absenceEditableUntil = (absence) => DateTime.add(absence.createdAt, { hours: 1 })`.

## Transitions

One named input type per transition; the transition and its policies take the same type.

```ts
type ArchiveAbsenceInput  = { readonly absence: ActiveAbsence; readonly actor: AbsenceActor; readonly now: DateTime.Utc }
type ReassignAbsenceInput = { readonly absence: EditableAbsence; readonly actor: AbsenceActor; readonly assigneeId: UserId
                              readonly now: DateTime.Utc; readonly assigneeIsOrganizationMember: boolean }

archiveAbsence(input: ArchiveAbsenceInput)
  → Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>

archiveAbsence = (input: ArchiveAbsenceInput) => Result.gen(function* () {
  yield* checkPolicies(archiveAbsencePolicies, input)                 // first rejection wins
  return AbsenceArchivedEvent.make({
    absenceId: input.absence.absenceId, organizationId: input.absence.organizationId,
    actorId: input.actor.userId, occurredOn: input.now })
})
```

- The `absence` field's type is the state that allows the transition: passing a `DraftAbsence` to `archiveAbsence` doesn't compile.
- Each transition exists once; states share it through a union until their rules diverge.
- Order: state (by the narrowing read) → policies in list order → value construction (`yield* createPeriod(...)`).
- A fact loaded by I/O is a required input field (`assigneeIsOrganizationMember`), so a use case that forgets to load it doesn't compile.
- A system intent (a nightly job) gets its own transition without an actor: `archiveEndedAbsence({ absence, now })`.

## Events

- One `Schema.TaggedStruct` per event, past tense + `Event`, built with `X.make({...})`. Union: `AbsenceEvent`.
- Common fields: `absenceId`, `organizationId`, `actorId`, `occurredOn`. Add what subscribers need: `previousPeriod` on reschedule, `assigneeId` and `period` on delete (the absence is gone).
- Serialize through the event schema, never `JSON.stringify`.

## Domain errors

```ts
class AbsenceEditWindowClosedError extends Data.TaggedError("AbsenceEditWindowClosedError")<{
  readonly absenceId: AbsenceId; readonly createdAt: DateTime.Utc; readonly editableUntil: DateTime.Utc
}> {}
```

- `Data.TaggedError` with rich context (ids, state, dates) for traces. Not a schema, so no endpoint can return one to a client.
- No failure events.
- State errors name the actual state relative to the one-way lifecycle: *still* = not far enough, *already* = past it. A find raises them without knowing the command, and they read right for every command.
- A race between find and write is typed (`AbsenceChangedConcurrentlyError`, 409): the client recovers by reloading.
- `AbsenceError`, the union of all domain errors, exists only for the exhaustive HTTP mapper; never use it in a signature.
