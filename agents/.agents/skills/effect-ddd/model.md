# Model

The model is the core type's lifecycle as data and pure functions: one schema per state, and one transition per use case that takes the state allowing it and returns an event. Get the states right: each holds exactly the fields it guarantees, so acting on a wrong state doesn't compile. Pure: no services, no I/O.

## Ids

The domain owns its id format: a prefixed cuid2, not a UUID.

```ts
// lib/prefixed-id.ts
export const prefixedId = (prefix: string) =>
  Schema.String.pipe(Schema.check(Schema.isPattern(new RegExp(`^${prefix}_[a-z][a-z0-9]{23}$`))))

export const createPrefixedId = (prefix: string): string => `${prefix}_${createId()}`
```

```ts
// absence/domain/absence-id.ts
export const AbsenceId = prefixedId("abs").pipe(Schema.brand("AbsenceId"))
export type AbsenceId = typeof AbsenceId.Type
export const generateAbsenceId = (): AbsenceId => AbsenceId.make(createPrefixedId("abs"))
```

- `make` checks the pattern, so a generator with the wrong prefix throws on its first call.
- The id gets its own file, not `absence.ts`. Events need it when their file loads, and `absence.ts` imports the events for `X.make`. In one file that is an import cycle that breaks depending on which module loads first.

- Ids of other modules (`OrganizationId`, `UserId`) are their brands; reference them, never redefine them.
- Identity is hybrid: the client may send the id (optimistic UI, idempotent retries); otherwise the create use case calls `generateAbsenceId()`. A taken id → `AbsenceAlreadyExistsError`.

## States

```ts
// absence/domain/absence.ts
const absenceFields = {
  absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId,
  period: Period, createdAt: Schema.DateTimeUtc,
}

export const DraftAbsence = Schema.TaggedStruct("DraftAbsence", { ...absenceFields })
export type DraftAbsence = typeof DraftAbsence.Type

export const ActiveAbsence = Schema.TaggedStruct("ActiveAbsence", { ...absenceFields, activatedAt: Schema.DateTimeUtc })
export type ActiveAbsence = typeof ActiveAbsence.Type
// …one per state
export type Absence = DraftAbsence | ActiveAbsence | ArchivedAbsence   // nothing decodes to it
export type EditableAbsence = DraftAbsence | ActiveAbsence
```

- One `Schema.TaggedStruct` per state, with exactly the fields that state guarantees.
- Name states and unions of states as in [naming.md](naming.md): the fact the find checked.
- The core type is what the domain decides on, so it carries the status. A status one level above the rules is the wrong core type: rules about each child but the status on the parent, one child can't be accepted or withdrawn alone, a bridge loops over the children. Split the parent into one core type per child.

## Value objects

A constructor returns a `Result`; a question about the value is a plain function.

```ts
// absence/domain/period.ts
export const createPeriod = ({ from, to }: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }): Result.Result<Period, InvalidPeriodError> =>
  DateTime.isLessThan(from, to) ? Result.succeed({ from, to }) : Result.fail(new InvalidPeriodError({ from, to }))

// from <= now < to. Not DateTime.between: it includes both ends.
export const isPeriodOngoingAt = ({ period, now }: { readonly period: Period; readonly now: DateTime.Utc }): boolean =>
  DateTime.isGreaterThanOrEqualTo(now, period.from) && DateTime.isLessThan(now, period.to)
```

## Time

- `DateTime.Utc` (`Schema.DateTimeUtc`) in states, events, errors, views, and HTTP. `Date` exists only at Prisma ([repository.md](repository.md)).
- `Utc`, not `Zoned`, until a rule depends on local calendar days.
- `now` comes from `DateTime.now` in the use case (it reads `Clock`, so tests use `TestClock`).
- Compare with `DateTime.isLessThan` and friends, never `<` or `===`. Write intervals out (`from <= now < to`); `DateTime.between` includes both ends.
- An instant that a rule checks and an error reports is one function: `absenceEditableUntil = (absence) => DateTime.add(absence.createdAt, { hours: 1 })`.

## Transitions

One named input type per transition; the transition and its rules take the same type.

```ts
// absence/domain/absence.ts
export type ReassignAbsenceInput = {
  readonly absence: EditableAbsence; readonly actor: AbsenceActor
  readonly assigneeId: UserId; readonly assigneeIsOrganizationMember: boolean; readonly now: DateTime.Utc
}
export type ArchiveAbsenceInput = { readonly absence: ActiveAbsence; readonly actor: AbsenceActor; readonly now: DateTime.Utc }
// …one input per transition
export const archiveAbsence = (input: ArchiveAbsenceInput): Result.Result<
  AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError
> => Result.gen(function* () {
  yield* checkRules(archiveAbsenceRules, input)
  return AbsenceArchivedEvent.make({
    absenceId: input.absence.absenceId, organizationId: input.absence.organizationId, actorId: input.actor.userId,
    occurredOn: input.now,
  })
})
```

- The `absence` field's type is the state that allows the transition: passing a `DraftAbsence` to `archiveAbsence` doesn't compile.
- Each transition exists once; states share it through a union until their rules diverge.
- Order: state (by the narrowing read) → rules in list order → value construction (`yield* createPeriod(...)`).
- A fact loaded by I/O is a required input field (`assigneeIsOrganizationMember`), so a use case that forgets to load it doesn't compile.
- System intents (a nightly job) are open; see the trigger table in [access.md](access.md).

## Events

```ts
// absence/domain/absence-event.ts
const absenceEventFields = { absenceId: AbsenceId, organizationId: OrganizationId, actorId: UserId, occurredOn: Schema.DateTimeUtc }

export const AbsenceDraftedEvent = Schema.TaggedStruct("AbsenceDraftedEvent", {
  ...absenceEventFields, creatorId: UserId, assigneeId: UserId, period: Period, // occurredOn becomes createdAt
})
export type AbsenceDraftedEvent = typeof AbsenceDraftedEvent.Type
// …one per event
export const AbsenceEvent = Schema.Union([
  AbsenceDraftedEvent, AbsenceRescheduledEvent, AbsenceReassignedEvent,
  AbsenceActivatedEvent, AbsenceArchivedEvent, AbsenceDeletedEvent,
])
```

- One `Schema.TaggedStruct` per event, past tense + `Event`, built with `X.make({...})`. Union: `AbsenceEvent`.
- Common fields: `absenceId`, `organizationId`, `actorId` (with an actor, [access.md](access.md)), `occurredOn`. Add what subscribers need: `previousPeriod` on reschedule, `assigneeId` and `period` on delete (the absence is gone).
- Serialize through the event schema, never `JSON.stringify`.
- `absence-event.ts` never imports `absence.ts`. Every schema an event uses (ids, value objects like `Period`) lives in its own file.

## Domain errors

```ts
// absence/domain/absence-error.ts
export class AbsenceEditWindowClosedError extends Data.TaggedError("AbsenceEditWindowClosedError")<{
  readonly absenceId: AbsenceId; readonly createdAt: DateTime.Utc; readonly editableUntil: DateTime.Utc
}> {}
```

- `Data.TaggedError` with rich context (ids, state, dates) for traces. Not a schema, so no endpoint can return one to a client.
- State errors name the actual state relative to the one-way lifecycle: *still* = not far enough, *already* = past it. A find raises them without knowing the command, and they read right for every command.
- A race between find and write is typed (`AbsenceChangedConcurrentlyError`, 409): the client recovers by reloading.
- `AbsenceError`, the union of all domain errors, exists only for the exhaustive HTTP mapper.
