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
- Identity is hybrid: the client may send the id (optimistic UI, idempotent retries); otherwise the create use case calls `generateAbsenceId()`. A taken id is a create that lost a race: `AbsenceChangedConcurrentlyError` ([repository.md](repository.md#port)).

## States

```ts
// absence/domain/absence.ts
const absenceFields = {
  absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId,
  period: Period, createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,   // the instant of the last event; the repository guards on it
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

- A value's constraint lives on its schema once, and payloads, states, and views decode with it: `AbsenceReasonName = Schema.Trimmed.check(Schema.isNonEmpty(), Schema.makeFilter(hasOnlyNameCharacters)).pipe(Schema.brand("AbsenceReasonName"))`. No twin (`NewAbsenceReasonName`, `AbsenceReasonNameInput`) with more or fewer checks.
- Equality other than `===` is an `Equivalence` beside the schema, not a normalize or key function: `AbsenceReasonNameEquivalence = Equivalence.mapInput(Equivalence.String, (name: string) => name.toLowerCase())`. It folds only what the schema leaves open: a trimmed name needs no `trim`.

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
- A transition with one rule calls it in place of `checkRules` ([rules.md](rules.md)); one without rules returns the event, not a `Result`, and the use case calls it without `Effect.fromResult`. The `Result` arrives with the first rule.
- A system intent (a nightly job, another module's event) has no actor: see the trigger table in [access.md](access.md).

## Evolve

A transition decides; `evolve` applies. One per core type, total over the state before and every event of the type: `Option<State>` in, `Option<State>` out, `None` meaning the thing doesn't exist (before a create, after a delete).

```ts
// absence/domain/absence.ts
export type EvolveAbsenceInput = { readonly absence: Option.Option<Absence>; readonly event: AbsenceEvent }
export const evolveAbsence = ({ absence, event }: EvolveAbsenceInput): Option.Option<Absence> =>
  Match.valueTags(event, {
    AbsenceDraftedEvent: (event) => Option.some(DraftAbsence.make({
      absenceId: event.absenceId, organizationId: event.organizationId, creatorId: event.creatorId,
      assigneeId: event.assigneeId, period: event.period, createdAt: event.occurredOn, updatedAt: event.occurredOn,
    })),
    AbsenceReassignedEvent: (event) => Option.map(absence, (absence) => ({ ...absence, assigneeId: event.assigneeId, updatedAt: event.occurredOn })),
    AbsenceActivatedEvent: (event) => Option.map(absence, (absence) => ActiveAbsence.make({ ...absenceFieldsOf(absence), activatedAt: event.occurredOn, updatedAt: event.occurredOn })),
    AbsenceDeletedEvent: () => Option.none(),
    // …one branch per event
  })
```

- `evolve` trusts `decide`: it checks no rule and no state, because the transition that produced the event already did. An event applied to a state it can't change (an `AbsenceActivatedEvent` on an `ArchivedAbsence`) is a defect upstream; `evolve` maps what it can and never fails.
- `Match.valueTags`: a new event doesn't compile until `evolve` applies it. An event that changes nothing in the state (`AbsenceValidationRequestedEvent`) returns `absence` unchanged, written out, so the reader sees the decision.
- Every branch sets `updatedAt: event.occurredOn`: the state after `evolve` is exactly the row the repository stores, and `before.updatedAt` is the guard it stores it behind ([repository.md](repository.md#save)).
- Where it's read: the use case hands `before` and `after` to `saveAbsence`, and the repository stores `after` without reading the event; tests apply `decide` then `evolve` and assert on the state, with no database ([testing.md](testing.md)); a use case that needs the state after its own event (a second transition in the same intent, a policy that reads the result) has `after` and reads nothing back.
- It is the one statement of what each event means for the state. Nothing else, no SQL and no handler, restates it.

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
- A race between find and write is typed (`AbsenceChangedConcurrentlyError`, 409), a create whose id is already taken included: the client recovers by reloading.
- `AbsenceError`, the union of all domain errors, exists only for the exhaustive HTTP mapper.
