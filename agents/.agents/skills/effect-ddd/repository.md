# Repository

The repository is the write side's port: it loads the state a command needs and stores the state `evolve` produced. It never sees an event: what an event means for the state is said once, in `evolve` ([model.md](model.md#commands)), and the use case publishes it ([use-cases.md](use-cases.md#service)). No generic update. The port lives in the domain; the Prisma adapter lives in `infrastructure/`.

## Port

```ts
// absence/domain/absence-repository.ts
export type FindAbsenceByIdInput = { readonly organizationId: OrganizationId; readonly absenceId: AbsenceId }

// One write per kind of event, with the states it needs: a create has no state before.
export type InsertAbsenceInput = { readonly after: Absence }
export type UpdateAbsenceInput = { readonly before: Absence; readonly after: Absence }

export type PurgeArchivedAbsencesInput = { readonly archivedBefore: DateTime.Utc }

export class AbsenceRepository extends Context.Service<AbsenceRepository, {
  findDraftAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<DraftAbsence, AbsenceNotFoundError | AbsenceAlreadyActiveError | AbsenceAlreadyArchivedError>
  findActiveAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
  findEditableAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
  insertAbsence(input: InsertAbsenceInput): Effect.Effect<void, AbsenceChangedConcurrentlyError>
  updateAbsence(input: UpdateAbsenceInput): Effect.Effect<void, AbsenceChangedConcurrentlyError>
  // archived and discarded rows, every organization: the retention sweep
  purgeArchivedAbsences(input: PurgeArchivedAbsencesInput): Effect.Effect<void>
}>()("AbsenceRepository") {}
```

- **Finds narrow**: one per set of states a command accepts (its `from`). Each returns that state or the error named after the state it found.
- **Two writes, ever**: each stores `after`, guarded by `before`. A new event or command adds nothing here. No write deletes: withdraw is an update into a terminal state.
- **A purge is outside the aggregate**: it removes old terminal rows across organizations, decides nothing, publishes nothing, and dies on any failure.
- **One error**: every write fails the same way, when the row is not in the state `before` says: an id already taken on insert, no row matching the guard on update. Both mean another write came first, and the client recovers the same way (reload). A user-visible unique key the module has (`Organization.slug`) is its own domain error (`OrganizationSlugTakenError`) next to it on the write, declared per module, not per event.
- **Make illegal states unrepresentable.** Two methods with the states each needs, not one `save` over a pair of `Option<Absence>`: the pair also allows `(None, None)`, which no event means, so the adapter would die on it and every use case wrap its state in `Option.some`.
- Rejected: one write per event (`publishAbsenceEvent(event)` mapped to SQL by tag): it stated each event's meaning twice, in `evolve` and in SQL, needed `previous…` fields on events for the guards, and grew the repository with every use case.

## Expected failures

The port declares no infrastructure errors. Each operation has one expected failure that becomes a domain error; every other failure dies.

| Operation | Expected failure | Becomes |
|---|---|---|
| find by id | no row | `AbsenceNotFoundError` |
| `insertAbsence` | id taken | `AbsenceChangedConcurrentlyError` |
| `updateAbsence` | no row matched the guard | `AbsenceChangedConcurrentlyError` |

With Prisma, a find (`findUniqueOrThrow`) and a guarded `update` fail with `PrismaRecordNotFoundError`; a taken id is `PrismaUniqueConstraintError`. Each operation catches its expected one and dies on the rest ([Finds](#finds), [Writes](#writes)).

## Finds

```ts
// absence/infrastructure/prisma-absence-repository.ts
  const findActiveAbsenceById = Effect.fn("PrismaAbsenceRepository.findActiveAbsenceById")(
    function* ({ organizationId, absenceId }: FindAbsenceByIdInput) {
      const row = yield* prisma.absence.findUniqueOrThrow({ where: { id: absenceId, organizationId }, select: absenceSelect }).pipe(
        Effect.catchTag(
          "PrismaRecordNotFoundError",
          () => new AbsenceNotFoundError({ absenceId }),
          (error) => Effect.die(error),
        ),
      )
      return yield* Match.value(row.status).pipe(
        Match.when("draft", () => new AbsenceStillDraftError({ absenceId })),
        Match.when("active", () => decodeActiveAbsence(row)),
        Match.when("archived", () => new AbsenceAlreadyArchivedError({ absenceId })),
        Match.when("discarded", () => new AbsenceAlreadyArchivedError({ absenceId })),
        Match.exhaustive,
      )
    },
  )
  // …one per find in the port: an allowed status decodes, any other fails with the error named after it
```

- Check `status` first, then decode only the state the find returns. Nothing decodes the full union.
- `status` is a Prisma enum, so the match is exhaustive and a new state doesn't compile until every find handles it.
- A row with an allowed `status` that doesn't decode is corrupt: die.
- `organizationId` next to the unique `id` in `where`: another tenant's row is not found. A host with soft deletes adds `deletedAt: null` to every find and guard.

## Decoding rows

No row schemas. Prisma's `select` types the row; reshape it into the domain shape and decode with the domain schema.

```ts
// lib/with-optional-tag.ts
// Same schema, but decoding input may omit `_tag`; the schema's own tag fills it in. Decode only.
// Struct.assign, not `({ ...fields, _tag })`: with generic Fields the spread types the decoded _tag as never.
export const withOptionalTag = <Tag extends SchemaAST.LiteralValue, Fields extends Schema.Struct.Fields>(
  schema: Pick<Schema.Struct<Fields>, "fields" | "mapFields"> & { readonly fields: { readonly _tag: Schema.tag<Tag> } },
) => schema.mapFields(Struct.assign({ _tag: Schema.tagDefaultOmit(schema.fields._tag.schema.literal) }))
```

```ts
// lib/date-time-utc-from-date.ts
export const dateTimeUtcFromDate = <D extends Date | null>(date: D): D extends Date ? DateTime.Utc : null =>
  (date === null ? null : DateTime.fromDateUnsafe(date)) as D extends Date ? DateTime.Utc : null
```

```ts
// absence/infrastructure/prisma-absence-repository.ts
const ActiveAbsenceFromFields = withOptionalTag(ActiveAbsence).mapFields((fields) => ({
  ...fields,
  // the column is nullable, the state isn't: a null fails the decode
  activatedAt: Schema.NullOr(Schema.DateTimeUtc).pipe(Schema.refine(Predicate.isNotNull)),
}))
…
const decodeActiveAbsence = (row: AbsenceRow) =>
  Schema.decodeEffect(ActiveAbsenceFromFields)({
    ...absenceFieldsFromRow(row),
    activatedAt: dateTimeUtcFromDate(row.activatedAt),
  }).pipe(Effect.orDie)
```

- `Schema.decodeEffect`, not `decodeUnknownEffect`: the input is typed as the schema's `Encoded`, so a reshape that misses or mistypes a field fails to compile. At runtime the decode still checks brands, the id pattern, and `DateTime`.
- A nullable column that a state requires: `NullOr(X).pipe(Schema.refine(Predicate.isNotNull))`. A `null` fails the decode and dies like any corrupt row. No branch before the decode.
- `…FromFields` marks the decode-only variants; the state schema stays the schema for everything else.

## Encoding states

The inverse of the decode: one row shape from each state, exhaustive over the states.

```ts
// absence/infrastructure/prisma-absence-repository.ts
const absenceRowFromState = (absence: Absence): Prisma.AbsenceUncheckedCreateInput =>
  Match.valueTags(absence, {
    DraftAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: AbsenceStatus.draft, activatedAt: null, archivedAt: null }),
    ActiveAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: AbsenceStatus.active, activatedAt: DateTime.toDateUtc(absence.activatedAt), archivedAt: null }),
    ArchivedAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: AbsenceStatus.archived, activatedAt: DateTime.toDateUtc(absence.activatedAt), archivedAt: DateTime.toDateUtc(absence.archivedAt) }),
    DiscardedAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: AbsenceStatus.discarded, activatedAt: null, archivedAt: DateTime.toDateUtc(absence.archivedAt) }),
  })
```

- `Match.valueTags` over the states: a new state doesn't compile until it has a row shape.
- `AbsenceStatus.draft` (the enum Prisma generates), not `"draft"`: `Match.valueTags` infers each branch on its own, so a bare literal widens to `string` and the row type rejects it.
- Every column is written, from the state. The state carries `updatedAt` and `evolve` sets it from the event, so the row is `after` and nothing else ([model.md](model.md#commands)).
- Convert every `DateTime.Utc` with `DateTime.toDateUtc`.

## Writes

```ts
// absence/infrastructure/prisma-absence-repository.ts
// the row the write must still find: before's identity and updatedAt
const absenceGuard = (before: Absence) =>
  ({ id: before.absenceId, organizationId: before.organizationId, updatedAt: DateTime.toDateUtc(before.updatedAt) })

const insertAbsence = Effect.fn("PrismaAbsenceRepository.insertAbsence")(
  function* ({ after }: InsertAbsenceInput) {
    yield* prisma.absence.create({ data: absenceRowFromState(after), select: { id: true } }).pipe(
      Effect.catchTag(
        "PrismaUniqueConstraintError",
        () => new AbsenceChangedConcurrentlyError({ absenceId: after.absenceId }),
        (error) => Effect.die(error),
      ),
    )
  },
)

const updateAbsence = Effect.fn("PrismaAbsenceRepository.updateAbsence")(
  function* ({ before, after }: UpdateAbsenceInput) {
    yield* prisma.absence.update({ where: absenceGuard(before), data: absenceRowFromState(after), select: { id: true } }).pipe(
      Effect.catchTag(
        "PrismaRecordNotFoundError",
        () => new AbsenceChangedConcurrentlyError({ absenceId: before.absenceId }),
        (error) => Effect.die(error),
      ),
    )
  },
)

const purgeArchivedAbsences = Effect.fn("PrismaAbsenceRepository.purgeArchivedAbsences")(
  function* ({ archivedBefore }: PurgeArchivedAbsencesInput) {
    yield* prisma.absence.deleteMany({
      where: { status: { in: [AbsenceStatus.archived, AbsenceStatus.discarded] }, archivedAt: { lt: DateTime.toDateUtc(archivedBefore) } },
    }).pipe(Effect.orDie)
  },
)
```

- The guard is `before`'s identity and `updatedAt`. It catches every write between find and save, whatever field it touched, so events carry no `previous…` fields for the guard.
- The guard sits in `where` of `update`, not `updateMany` plus a `count === 0` check. No row matched → the expected failure ([Expected failures](#expected-failures)).
- One Prisma call each: insert, guarded update. Writes `select: { id: true }`: nothing is read back; a caller that needs the state after the write has `after`.
- A write publishes nothing. The use case publishes after it, not atomically; [Atomic events](#atomic-events) is the opt-in.
- Prisma's query API, not raw SQL. Raw SQL only for a behavior a story decision names and the API can't express.
- Cost: `updatedAt` has millisecond precision, so two writes of one row within the same millisecond could pass each other's guard. A host that needs more adds a `version` column and guards on it instead.

## Atomic events

Opt-in. By default the use case writes, then publishes: a crash in between loses the event. Add this only when a host must never lose one.

The host owns two ports in `shared/`: `Transactions.runInTransaction`, and an outbox that takes the event instead of `DomainEvents`. The outbox requires `Transaction`, which only `runInTransaction` provides:

```ts
// shared/transaction.ts
// Proof that an effect runs inside a database transaction. Only runInTransaction provides it.
export class Transaction extends Context.Service<Transaction, {}>()("Transaction") {}

// Owned by the host: it opens the transaction its adapters share.
export class Transactions extends Context.Service<Transactions, {
  // Commits when the effect succeeds, rolls back when it fails.
  runInTransaction<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, Transaction>>
}>()("Transactions") {}
```

```ts
// shared/domain-events.ts
export class DomainEventOutbox extends Context.Service<DomainEventOutbox, {
  addDomainEvent(event: DomainEvent): Effect.Effect<void, never, Transaction>
}>()("DomainEventOutbox") {}
```

```ts
// absence/application/archive-absence-service.ts
        // atomic: the archive and its event commit together, or neither does
        yield* absenceRepository.updateAbsence({ before: absence, after: Absence.evolve({ absence, event }) }).pipe(
          Effect.andThen(domainEventOutbox.addDomainEvent(event)),
          transactions.runInTransaction,
        )
```

- Opt in per use case. The writes don't require `Transaction`: they join a transaction when one is open, so a use case that doesn't opt in stays as it is.
- An outbox write outside `runInTransaction` doesn't compile: its `Transaction` stays in the requirements. The adapter yields `Transaction` to put it there.
- The use case's error union doesn't change: a domain error inside the transaction rolls it back and comes out typed.
- The relay that delivers outbox rows belongs to the host.

With `effect-prisma-generator`, `PrismaService.$transaction(effect)` already passes the transaction client through the context, so `Transaction` carries nothing and the repository adapter doesn't change:

```ts
// lib/prisma-transactions.ts
// Every PrismaService call inside the effect joins the transaction: the generated client reads it from the context.
// Sandboxed: the generated $transaction rethrows Cause.squash, which turns a defect into a typed failure. The whole
// cause passes through instead; anything else it throws (the commit failed) dies.
export const PrismaTransactions = Layer.effect(Transactions, Effect.gen(function* () {
  const prisma = yield* PrismaService
  return Transactions.of({
    runInTransaction: (effect) =>
      prisma.$transaction(effect.pipe(Effect.provideService(Transaction, Transaction.of({})), Effect.sandbox)).pipe(
        Effect.catch((cause) => Cause.isCause(cause) ? Effect.failCause(cause) : Effect.die(cause)),
      ),
  })
}))
```

- Without the sandbox, a defect or an interruption inside the transaction comes out as a typed failure: the error channel lies.
