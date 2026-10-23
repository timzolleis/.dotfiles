# Repository

The repository is the write side's port: it loads the state a transition needs and persists the event the transition returns. No generic save or update. The port lives in the domain; the Prisma adapter lives in `infrastructure/`.

## Port

```ts
// absence/domain/absence-repository.ts
export type FindAbsenceByIdInput = { readonly organizationId: OrganizationId; readonly absenceId: AbsenceId }

// The constraint makes it exhaustive: a new event doesn't compile until it names its write error.
type OneEntryPerAbsenceEventTag<T extends Record<AbsenceEvent["_tag"], unknown>> = T
export type AbsenceEventWriteErrors = OneEntryPerAbsenceEventTag<{
  AbsenceDraftedEvent: AbsenceAlreadyExistsError
  AbsenceRescheduledEvent: AbsenceChangedConcurrentlyError
  // …one per event
}>

export class AbsenceRepository extends Context.Service<AbsenceRepository, {
  findDraftAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<DraftAbsence, AbsenceNotFoundError | AbsenceAlreadyActiveError | AbsenceAlreadyArchivedError>
  findActiveAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
  findEditableAbsenceById(input: FindAbsenceByIdInput):
    Effect.Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
  publishAbsenceEvent<Tag extends AbsenceEvent["_tag"]>(event: MemberWithTag<AbsenceEvent, Tag>): Effect.Effect<void, AbsenceEventWriteErrors[Tag]>
}>()("AbsenceRepository") {}
```

- **Finds narrow**: one per set of states a transition accepts. Each returns that state or the error named after the state it found.
- **One write**: `publishAbsenceEvent(event)` maps each event to a write, then publishes it. A union of events gives the union of their errors.
- Rejected: splitting into `insertAbsence` + `publishAbsenceEvent` (two methods per change).

## Expected failures

The port declares no infrastructure errors. Each operation has one expected failure that becomes a domain error; every other failure dies.

| Operation | Expected failure | Becomes |
|---|---|---|
| find by id | no row | `AbsenceNotFoundError` |
| insert | id taken | `AbsenceAlreadyExistsError` |
| guarded update / delete | no row matched the guard | `AbsenceChangedConcurrentlyError` |

With Prisma, a find (`findUniqueOrThrow`) and a guarded `update` / `delete` fail with `PrismaRecordNotFoundError`; a taken id is `PrismaUniqueConstraintError`. Each operation catches its expected one and dies on the rest ([Finds](#finds), [Writes](#writes)).

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
- `organizationId` next to the unique `id` in `where`: another tenant's row is not found.

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

## Writes

One guarded write per event, then publish:

| Event | Write | Guard (`where`, plus `id` and `organizationId`) | Expected failure |
|---|---|---|---|
| `AbsenceDraftedEvent` | `create { status: "draft", …, createdAt: occurredOn }` | — | id taken → `AbsenceAlreadyExistsError` |
| `AbsenceRescheduledEvent` | `update { from, to }` | `status in ["draft", "active"]` | no row → `AbsenceChangedConcurrentlyError` |
| `AbsenceReassignedEvent` | `update { assigneeId }` | `status in ["draft", "active"]` | no row → `AbsenceChangedConcurrentlyError` |
| `AbsenceActivatedEvent` | `update { status: "active", activatedAt: occurredOn }` | `status: "draft"` | no row → `AbsenceChangedConcurrentlyError` |
| `AbsenceArchivedEvent` | `update { status: "archived", archivedAt: occurredOn }` | `status: "active"` | no row → `AbsenceChangedConcurrentlyError` |
| `AbsenceDeletedEvent` | `delete` | `status in ["draft", "active"]` | no row → `AbsenceChangedConcurrentlyError` |

```ts
// absence/infrastructure/prisma-absence-repository.ts
// Out is the port's error map, given explicitly: inferred from the writes, it wouldn't match AbsenceEventWriteErrors[Tag] for a generic Tag.
const writeAbsenceEvent = matchTag<AbsenceEvent>()<{
  readonly [Tag in AbsenceEvent["_tag"]]: Effect.Effect<void, AbsenceEventWriteErrors[Tag]>
}>({
  AbsenceArchivedEvent: (event) =>
    prisma.absence.update({
      where: { id: event.absenceId, organizationId: event.organizationId, status: "active" },
      data: { status: "archived", archivedAt: DateTime.toDateUtc(event.occurredOn) },
      select: { id: true },
    }).pipe(
      Effect.catchTag(
        "PrismaRecordNotFoundError",
        () => new AbsenceChangedConcurrentlyError({ absenceId: event.absenceId }),
        (error) => Effect.die(error),
      ),
      Effect.asVoid,
    ),
  // …one per event, as in the table
})

const publishAbsenceEvent = Effect.fn("PrismaAbsenceRepository.publishAbsenceEvent")(
  function* <Tag extends AbsenceEvent["_tag"]>(event: MemberWithTag<AbsenceEvent, Tag>) {
    yield* writeAbsenceEvent(event)
    yield* domainEvents.publishDomainEvent(event)   // not atomic with the write
  },
)
```

- The guard sits in `where` of `update` / `delete`, not `updateMany` / `deleteMany` plus a `count === 0` check. No row matched → the expected failure ([Expected failures](#expected-failures)).
- The guard also holds each field the transition read and the write replaces (`assigneeId: event.previousAssigneeId`): a change between find and write fails the guard instead of being overwritten.
- No cast. A missing write, an unknown tag, or a write whose error differs from `AbsenceEventWriteErrors` doesn't compile.
- Convert every `DateTime.Utc` with `DateTime.toDateUtc`. Writes `select: { id: true }`: nothing is read back.
- Write + publish are not atomic; delivery (outbox) belongs to the host.

### `matchTag`

`matchTag` is the one helper for tag dispatch whose result type follows the tag:

```ts
// lib/match-tag.ts
type Tagged = { readonly _tag: string }

export type MemberWithTag<U extends Tagged, Tag extends U["_tag"]> = Extract<U, { readonly _tag: Tag }>

type HandlersByTag<U extends Tagged, Out> = { readonly [Tag in keyof Out]: (value: MemberWithTag<U, Tag & U["_tag"]>) => Out[Tag] }

export const matchTag = <U extends Tagged>() =>
  <Out extends { readonly [Tag in U["_tag"]]: unknown }>(
    handlers: HandlersByTag<U, Out> & { readonly [Tag in Exclude<keyof Out, U["_tag"]>]: never },
  ) => {
    // Indexing the mapped type with a generic Tag keeps value and result correlated (TypeScript #47109).
    const handlerByTag: HandlersByTag<U, Out> = handlers
    return <Tag extends U["_tag"]>(value: MemberWithTag<U, Tag>): Out[Tag] => handlerByTag[value._tag](value)
  }
```

- `matchTag<U>()(handlers)`: one handler per tag of `U`; the result is `<Tag>(value: MemberWithTag<U, Tag>) => Out[Tag]`.
- Give `Out` when a declared type already fixes the result (the port here). Otherwise let it infer from the handlers ([http.md](http.md), HTTP errors).
- Not `Match.valueTags`: it returns the union of every branch's result, which a generic signature only accepts with a cast. `Match.valueTags` stays the default when the union is fine.
