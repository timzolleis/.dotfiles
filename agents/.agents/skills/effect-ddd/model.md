# Model

The model is the core type's lifecycle as one aggregate: one schema per state, one command per use case, one event per command, and per command a record that decides the event and evolves the state. Get the states right: each holds exactly the fields it guarantees, so a command on a wrong state doesn't compile. Pure: no services, no I/O.

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
- The id gets its own file, not `absence.ts`: errors, the repository, views, and other modules import it without loading the aggregate.

- Ids of other modules (`OrganizationId`, `UserId`) are their brands; reference them, never redefine them.
- Identity is hybrid: the client may send the id (optimistic UI, idempotent retries); otherwise the create use case calls `generateAbsenceId()`. A taken id is a create that lost a race: `AbsenceChangedConcurrentlyError` ([repository.md](repository.md#port)).

## The aggregate

One file, `domain/absence.ts`: the states, commands and events as exported one-liners, then `Aggregate.make`.

```ts
// absence/domain/absence.ts
const absenceFields = {
  absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId, period: Period,
  createdAt: Schema.DateTimeUtc, updatedAt: Schema.DateTimeUtc,
}
const absenceEventFields = { absenceId: AbsenceId, organizationId: OrganizationId, actorId: UserId, occurredOn: Schema.DateTimeUtc }

export class DraftAbsence     extends Schema.Opaque<DraftAbsence>()(Schema.TaggedStruct("DraftAbsence",     { ...absenceFields })) {}
export class ActiveAbsence    extends Schema.Opaque<ActiveAbsence>()(Schema.TaggedStruct("ActiveAbsence",    { ...absenceFields, activatedAt: Schema.DateTimeUtc })) {}
// …one per state
export class ArchiveAbsenceCommand    extends Schema.Opaque<ArchiveAbsenceCommand>()(Schema.TaggedStruct("ArchiveAbsenceCommand",    { actor: AbsenceActor })) {}
// …one per command
export class AbsenceRescheduledEvent extends Schema.Opaque<AbsenceRescheduledEvent>()(Schema.TaggedStruct("AbsenceRescheduledEvent", { ...absenceEventFields, period: Period, previousPeriod: Period })) {}
// …one per event

export type EditableAbsence = DraftAbsence | ActiveAbsence

export const Absence = Aggregate.make("Absence", {
  id: AbsenceId,
  states: { DraftAbsence, ActiveAbsence, ArchivedAbsence, DiscardedAbsence },
  commands: {
    DraftAbsenceCommand, RescheduleAbsenceCommand, ReassignAbsenceCommand, ActivateAbsenceCommand, ArchiveAbsenceCommand, WithdrawAbsenceCommand,
  },
  handlers: {
    // …one record per command
  },
})

export type Absence = Aggregate.State<typeof Absence>
export type AbsenceEvent = Aggregate.Event<typeof Absence>
```

- States, commands and events are `class X extends Schema.Opaque<X>()(Schema.TaggedStruct("X", {…})) {}`. The class only names the type: hovers and errors print `ActiveAbsence`, not the struct. Values stay plain objects built with `X.make`: no `new`, no methods.
- One state per schema, with exactly the fields that state guarantees. Name states and unions of states as in [naming.md](naming.md): the fact the find checked.
- `Absence` and `AbsenceEvent` are derived from the aggregate, never written: a second list next to `states:` drifts. A union of some states (`EditableAbsence`) is written.
- Nothing removes a row. Withdraw is a command that ends in a terminal state, and terminal states split by the data they hold: `ArchivedAbsence` keeps `activatedAt`, `DiscardedAbsence` (a withdrawn draft) never had one. A purge of old terminal rows is a repository method outside the aggregate ([repository.md](repository.md#port)).
- Events are past tense + `Event`, one per command. Common fields: `absenceId`, `organizationId`, `actorId` (with an actor, [access.md](access.md)), `occurredOn`, plus what subscribers need (`previousPeriod` on reschedule). Serialize through the event schema (`Absence.events.AbsenceArchivedEvent`), never `JSON.stringify`.
- The core type is what the domain decides on, so it carries the status. A status one level above the rules is the wrong core type: rules about each child but the status on the parent, one child can't be accepted or withdrawn alone, a bridge loops over the children. Split the parent into one core type per child.

## Commands

One record per command, `{ from, event, decide, evolve }`, keyed by the command's tag:

```ts
// absence/domain/absence.ts
    DraftAbsenceCommand: {
      from: ["initial"],
      …
      evolve: {
        initial: ({ event }) => DraftAbsence.make({
          absenceId: event.absenceId, organizationId: event.organizationId, creatorId: event.creatorId,
          assigneeId: event.assigneeId, period: event.period, createdAt: event.occurredOn, updatedAt: event.occurredOn,
        }),
      },
    },
    …
    ArchiveAbsenceCommand: {
      from: [ActiveAbsence],
      event: AbsenceArchivedEvent,
      decide: ({ absence, command, now }) => Result.gen(function* () {
        yield* checkPolicies([onlyCreatorOrPermittedCanEditPolicy, cannotArchiveWhileOngoingPolicy], { absence, actor: command.actor, now })
        return AbsenceArchivedEvent.make({
          absenceId: absence.absenceId, organizationId: absence.organizationId, actorId: command.actor.userId, occurredOn: now,
        })
      }),
      evolve: {
        ActiveAbsence: ({ absence, event }) => ArchivedAbsence.make({ ...absence, archivedAt: event.occurredOn, updatedAt: event.occurredOn }),
      },
    },
    WithdrawAbsenceCommand: {
      from: [DraftAbsence, ActiveAbsence],
      …
      evolve: {
        DraftAbsence:  ({ absence, event }) => DiscardedAbsence.make({ ...absence, archivedAt: event.occurredOn, updatedAt: event.occurredOn }),
        ActiveAbsence: ({ absence, event }) => ArchivedAbsence.make({ ...absence, archivedAt: event.occurredOn, updatedAt: event.occurredOn }),
      },
    },
```

- `from` lists the states the command is accepted in, or `"initial"` alone: no state exists yet, and there is no initial state value. A wrong state/command pair at `Absence.decide` doesn't compile, and the narrowing find raises the state errors, so there is no runtime "not allowed in this state" error.
- One event per command; two commands never decide the same event, so replay can tell their evolves apart. A command that ends in two states (withdraw) is one command with two evolves.
- `decide` is pure: `Result.gen`, never `Effect.gen`. Order: the rules in one `checkRules([…], input)` call with the input written out ([rules.md](rules.md)) → value construction (`yield* createPeriod(…)`) → `X.make` of the event. A decide without a rule or a constructor returns the bare event, and the use case calls it without `Effect.fromResult`.
- A fact loaded by I/O travels on the command as a required field (`assigneeIsOrganizationMember`), so a use case that forgets to load it doesn't compile.
- The command's errors are inferred from its decide, never declared on the command. A change shows where they are written out: the use case's signature and the exhaustive HTTP mapper.
- `evolve` has exactly one handler per `from` state. It gets the state without its tag and returns the full next state with `X.make`, never a hand-written `_tag`. It trusts `decide`: it checks no rule and never fails.
- `evolve` is the one statement of what each event means for the state. Every evolve sets `updatedAt: event.occurredOn`: the state after it is exactly the row the repository stores, behind the guard `before.updatedAt` ([repository.md](repository.md#writes)); the repository never sees the event.
- A system intent (a nightly job, another module's event) has no actor: see the trigger table in [access.md](access.md).
- Cost: each record names its states twice, in `from` and as `evolve` keys (the lib keeps them equal), and `evolve` can't read the tag: the handler's key is the state.
- Cost: `{ ...absence }` into another state's `X.make` silently drops the fields the target lacks (`activatedAt` into `DiscardedAbsence`). Check that the drop is the one you mean.
- Cost: while one record is broken, the other commands' decide and evolve fall back to `any`. Fix the error on the definition first; the calls' types are only checked after it.

## Aggregate.make

`Aggregate.make` lives in the host's `lib/aggregate.ts`. When the host has none, copy [lib/aggregate.ts](lib/aggregate.ts) there unchanged; never rewrite, trim, or re-derive it. Its tests live in the reference repo, github.com/timzolleis/effect-ddd-example. Hovering `command` or `absence` at a decide call, or `event` or `absence` at an evolve call, shows the candidates the other side allows.

| Surface | Gives |
|---|---|
| `Aggregate.make(name, { id, states, commands, handlers })` | the aggregate; each record is checked against `states` and `commands` |
| `Absence.decide({ absence, command, now })` | what the command's decide returns; no `absence` for an `"initial"` command |
| `Absence.evolve({ absence, event })` | the next state; no `absence` for the event of an `"initial"` command |
| `Absence.accepts.<State>`, `Absence.acceptedIn.<Command>` | the command tags a state accepts, the state tags a command is accepted in (`"initial"` included) |
| `Absence.states`, `.commands`, `.events` | the schemas by tag |
| `Aggregate.State`, `.Event`, `.Command`, `.Accepts`, `.AcceptedIn` | the same, as types: `Aggregate.State<typeof Absence>` |

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
