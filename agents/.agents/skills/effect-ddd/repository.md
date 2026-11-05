# Repository

The repository is the write side's port: it loads the state a transition needs and stores the state `evolve` produced. It never interprets an event; what an event means for the state is said once, in `evolve` ([model.md](model.md#evolve)). No generic update. The port lives in the domain; the Prisma adapter lives in `infrastructure/`.

## Port

```ts
// absence/domain/absence-repository.ts
export type FindAbsenceByIdInput = { readonly organizationId: OrganizationId; readonly absenceId: AbsenceId }

// before → after: None → Some inserts, Some → Some updates, Some → None deletes. The pair says which; nothing else does.
export type SaveAbsenceInput = {
  readonly event: AbsenceEvent
  readonly before: Option.Option<Absence>
  readonly after: Option.Option<Absence>
}

export class AbsenceRepository extends Context.Service<AbsenceRepository, {
  findDraftAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<DraftAbsence, AbsenceNotFoundError | AbsenceAlreadyActiveError | AbsenceAlreadyArchivedError>
  findActiveAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
  findEditableAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
  saveAbsence(input: SaveAbsenceInput): Effect.Effect<void, AbsenceChangedConcurrentlyError>
}>()("AbsenceRepository") {}
```

- **Finds narrow**: one per set of states a transition accepts. Each returns that state or the error named after the state it found.
- **One save**: stores `after`, guarded by `before`, then publishes `event`. A new event or a new transition adds nothing here.
- **One error**: every save fails the same way, when the row is not in the state `before` says: an id already taken on insert, no row matching the guard on update or delete. Both mean another write came first, and the client recovers the same way (reload). A user-visible unique key the module has (`Organization.slug`) is its own domain error (`OrganizationSlugTakenError`) next to it on `save`, declared per module, not per event.
- **Make illegal states unrepresentable; make illegal calls die.** `(None, None)` is a transition bug the decide → evolve test catches; it dies in the adapter. Narrowing the pair in types (`Option.Some` / `Option.None` arms, overloads on `evolve`) was rejected: it costs a `Some` constructor and three signatures to remove one `die`.
- Rejected: one write per event (`publishAbsenceEvent(event)` mapped to SQL by tag): it stated each event's meaning twice, in `evolve` and in SQL, needed `previous…` fields on events for the guards, and grew the repository with every use case.

## Expected failures

The port declares no infrastructure errors. Each operation has one expected failure that becomes a domain error; every other failure dies.

| Operation | Expected failure | Becomes |
|---|---|---|
| find by id | no row | `AbsenceNotFoundError` |
| save, `None → Some` | id taken | `AbsenceChangedConcurrentlyError` |
| save, `Some → …` | no row matched the guard | `AbsenceChangedConcurrentlyError` |

With Prisma, a find (`findUniqueOrThrow`) and a guarded `update` / `delete` fail with `PrismaRecordNotFoundError`; a taken id is `PrismaUniqueConstraintError`. Each operation catches its expected one and dies on the rest ([Finds](#finds), [Save](#save)).

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
  schema: Schema.TaggedStruct<Tag, Fields>,
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
    DraftAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: "draft", activatedAt: null, archivedAt: null }),
    ActiveAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: "active", activatedAt: DateTime.toDateUtc(absence.activatedAt), archivedAt: null }),
    ArchivedAbsence: (absence) => ({ ...absenceColumnsFromFields(absence), status: "archived", activatedAt: DateTime.toDateUtc(absence.activatedAt), archivedAt: DateTime.toDateUtc(absence.archivedAt) }),
  })
```

- `Match.valueTags` over the states: a new state doesn't compile until it has a row shape.
- Every column is written, from the state. The state carries `updatedAt` and `evolve` sets it from the event, so the row is `after` and nothing else ([model.md](model.md#evolve)).
- Convert every `DateTime.Utc` with `DateTime.toDateUtc`.

## Save

```ts
// absence/infrastructure/prisma-absence-repository.ts
const saveAbsence = Effect.fn("PrismaAbsenceRepository.saveAbsence")(
  function* ({ event, before, after }: SaveAbsenceInput) {
    if (Option.isNone(before)) {
      if (Option.isNone(after)) return yield* Effect.die(new Error(`${event._tag} evolved nothing from nothing`))
      yield* prisma.absence.create({ data: absenceRowFromState(after.value), select: { id: true } }).pipe(
        Effect.catchTag(
          "PrismaUniqueConstraintError",
          () => new AbsenceChangedConcurrentlyError({ absenceId: after.value.absenceId }),
          (error) => Effect.die(error),
        ),
      )
    } else {
      const guard = { id: before.value.absenceId, organizationId: before.value.organizationId, updatedAt: DateTime.toDateUtc(before.value.updatedAt) }
      yield* Option.match(after, {
        onSome: (after) => prisma.absence.update({ where: guard, data: absenceRowFromState(after), select: { id: true } }),
        onNone: () => prisma.absence.delete({ where: guard, select: { id: true } }),
      }).pipe(
        Effect.catchTag(
          "PrismaRecordNotFoundError",
          () => new AbsenceChangedConcurrentlyError({ absenceId: before.value.absenceId }),
          (error) => Effect.die(error),
        ),
      )
    }
    yield* domainEvents.publishDomainEvent(event)   // not atomic with the write
  },
)
```

- The guard is `before`'s identity and `updatedAt`. It catches every write between find and save, whatever field it touched, so events carry no `previous…` fields for the guard.
- The guard sits in `where` of `update` / `delete`, not `updateMany` / `deleteMany` plus a `count === 0` check. No row matched → the expected failure ([Expected failures](#expected-failures)).
- Three writes, ever: insert, guarded update, guarded delete (`update { deletedAt }` in a host with soft deletes). Writes `select: { id: true }`: nothing is read back; a caller that needs the state after the write has `after`.
- Write + publish are not atomic; delivery (outbox) belongs to the host.
- Prisma's query API, not raw SQL. Raw SQL only for a behavior a story decision names and the API can't express.
- Cost: `updatedAt` has millisecond precision, so two writes of one row within the same millisecond could pass each other's guard. A host that needs more adds a `version` column and guards on it instead.
