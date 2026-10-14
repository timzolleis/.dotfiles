# Repository

The repository is the write side's port: it loads the state a transition needs and persists the event the transition returns. No generic save or update. The port lives in the domain; the Prisma adapter lives in `infrastructure/`.

## Port

```ts
// domain/absence-repository.ts
class AbsenceRepository extends Context.Service<AbsenceRepository, {
  findDraftAbsenceById({ organizationId, absenceId }):    Effect<DraftAbsence, AbsenceNotFoundError | AbsenceAlreadyActiveError | AbsenceAlreadyArchivedError>
  findActiveAbsenceById({ organizationId, absenceId }):   Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
  findEditableAbsenceById({ organizationId, absenceId }): Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
  publishAbsenceEvent<E extends AbsenceEvent>(event: E): Effect<void, AbsenceEventWriteErrors[E["_tag"]]>
}>()("AbsenceRepository") {}

// the write error per event; the constraint makes it exhaustive (satisfies doesn't work on type aliases)
type ByAbsenceEventTag<T extends Record<AbsenceEvent["_tag"], unknown>> = T
type AbsenceEventWriteErrors = ByAbsenceEventTag<{
  AbsenceDraftedEvent:  AbsenceAlreadyExistsError         // insert
  AbsenceArchivedEvent: AbsenceChangedConcurrentlyError   // guarded update
  // …one entry per event
}>
```

- **Finds narrow**: one per set of states a transition accepts. Each returns that state or the error named after the state it found.
- **One write**: `publishAbsenceEvent(event)` maps each event to a write, then publishes it. A union of events gives the union of their errors.
- Rejected: splitting into `insertAbsence` + `publishAbsenceEvent` (two methods per change).

## Finds

```text
PrismaAbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })
├─ prisma.absence.findUniqueOrThrow({ where: { id: absenceId, organizationId }, select: absenceSelect })
│  └─ not found                  → AbsenceNotFoundError
└─ match row.status
   ├─ "draft"                    → AbsenceStillDraftError
   ├─ "active"                   → decodeActiveAbsence(row): Effect<ActiveAbsence>; decode failure → die
   └─ "archived"                 → AbsenceAlreadyArchivedError
```

- Check `status` first, then decode only the state the find returns. Nothing decodes the full union.
- `status` is a Prisma enum, so the match is exhaustive and a new state doesn't compile until every find handles it.
- A row with an allowed `status` that doesn't decode is corrupt: die.
- **`not found` is a placeholder.** `findUniqueOrThrow`, `update`, and `delete` fail when no row matches. Catch that failure the way the repo already does (e.g. `narrowPrismaError(PrismaRecordNotFoundError)` + `Effect.catchTag`). Find an existing repository that does it before writing a new helper.

## Decoding rows

No row schemas. Prisma's `select` types the row; reshape it into the domain shape and decode with the domain schema.

```ts
// lib/with-optional-tag.ts — decode-only variant whose input may omit _tag; the schema's own tag fills it in
export const withOptionalTag = <Tag extends SchemaAST.LiteralValue, Fields extends Schema.Struct.Fields>(
  schema: Schema.TaggedStruct<Tag, Fields>,
) => schema.mapFields((fields) => ({ ...fields, _tag: Schema.tagDefaultOmit(fields._tag.literal) }))

// lib/date-time-utc-from-date.ts — null stays null; the return type follows the input
export const dateTimeUtcFromDate = <D extends Date | null>(date: D): D extends Date ? DateTime.Utc : null =>
  (date === null ? null : DateTime.fromDateUnsafe(date)) as D extends Date ? DateTime.Utc : null

// private to PrismaAbsenceRepository, built once
const ActiveAbsenceFromFields = withOptionalTag(ActiveAbsence).mapFields((fields) => ({
  ...fields,
  activatedAt: Schema.NullOr(Schema.DateTimeUtc).pipe(Schema.refine(Predicate.isNotNull)),   // column nullable, state not
}))

decodeActiveAbsence(row) = Schema.decodeEffect(ActiveAbsenceFromFields)(
  { ...absenceFieldsFromRow(row), activatedAt: dateTimeUtcFromDate(row.activatedAt) }).pipe(Effect.orDie)
```

- `Schema.decodeEffect`, not `decodeUnknownEffect`: the input is typed as the schema's `Encoded`, so a reshape that misses or mistypes a field fails to compile. At runtime the decode still checks brands, the id pattern, and `DateTime`.
- A nullable column that a state requires: `NullOr(X).pipe(Schema.refine(Predicate.isNotNull))`. A `null` fails the decode and dies like any corrupt row. No branch before the decode.
- `…FromFields` marks the decode-only variants; the state schema stays the schema for everything else.

## Writes

| Event | Write | Guard (`where`, plus `id` and `organizationId`) |
|---|---|---|
| `AbsenceDraftedEvent` | `create { status: "draft", …, createdAt: occurredOn }` | — (primary key taken → `AbsenceAlreadyExistsError`) |
| `AbsenceRescheduledEvent` | `update { from, to }` | `status in ["draft", "active"]` |
| `AbsenceArchivedEvent` | `update { status: "archived", archivedAt }` | `status: "active"` |
| `AbsenceDeletedEvent` | `delete` | `status in ["draft", "active"]` |

```text
PrismaAbsenceRepository.publishAbsenceEvent(AbsenceArchivedEvent)
└─ prisma.absence.update({ where: { id: absenceId, organizationId, status: "active" }, data: { status: "archived", archivedAt } })
   └─ not found                  → AbsenceChangedConcurrentlyError
```

- `Match.valueTags(event, …)`, one write per event; exhaustive, so a new event without a write doesn't compile.
- `update` / `delete` with the guard in `where`, not `updateMany` / `deleteMany` plus a `count === 0` check.
- No row matched the guard → `AbsenceChangedConcurrentlyError`. Catch the not-found as in [Finds](#finds).
- Convert every `DateTime.Utc` with `DateTime.toDateUtc`.
- Then `DomainEvents.publishDomainEvent(event)`. Write + publish are not atomic; delivery belongs to the host's infrastructure.
- One cast at the return: inside the generic method `E` is unresolved, so `AbsenceEventWriteErrors[E["_tag"]]` doesn't reduce. A real-database test per guarded write covers what the cast hides.
