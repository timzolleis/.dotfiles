# Views

A view is what a client reads. Views bypass the model and the repository: a views port returns view schemas straight from storage, filtered by a visibility. Nothing on the write side reads a view.

```ts
// absence/view/absence-views.ts
export const AbsenceView = Schema.Struct({
  absenceId: AbsenceId,
  creatorId: UserId,
  assigneeId: UserId,
  from: Schema.DateTimeUtc,
  to: Schema.DateTimeUtc,
  status: Schema.Literals(["draft", "active", "archived"]),
  createdAt: Schema.DateTimeUtc,
  activatedAt: Schema.NullOr(Schema.DateTimeUtc),
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
})
export type AbsenceView = typeof AbsenceView.Type

// Absent filter = no condition. Named for the reader, not for a column: the adapter maps each one.
export type AbsenceListFilters = { readonly assigneeId?: UserId; readonly creatorId?: UserId }

export class AbsenceViews extends Context.Service<AbsenceViews, {
  // not visible = not found
  getAbsenceById(input: {
    readonly organizationId: OrganizationId; readonly visibility: AbsenceVisibility; readonly absenceId: AbsenceId
  }): Effect.Effect<AbsenceView, AbsenceNotFoundError>
  // filters combine with AND, then visibility
  listAbsences(input: {
    readonly organizationId: OrganizationId; readonly visibility: AbsenceVisibility; readonly filters: AbsenceListFilters
  }): Effect.Effect<ReadonlyArray<AbsenceView>>
}>()("AbsenceViews") {}
```

- Every method requires a visibility ([access.md](access.md)), so no read skips the read rule, including a command's read-back. A system read passes `AllAbsences()`.
- `get…` / `list…` are views; `find…` is the repository. Grepping `AbsenceById` finds both.
- The view is the API response schema. It holds only what the API shows (no `organizationId`: every request is scoped). Split off a response type + one mapping function only when a second consumer reads the view or the API needs a versioned contract.
- A status the view reports is a tagged union; each variant carries only its true fields (`OwnOverlappingAbsence { absenceId }`, `OthersOverlappingAbsence {}`), never ids of data the reader may not see. No string literals for a status.
- The client's mode ("editing absence X") is not a view argument: return the ids the client matches against.

## Adapter

```ts
// absence/infrastructure/prisma-absence-views.ts
const nonDraftOrCreatedByWhere = (userId: UserId): Prisma.AbsenceWhereInput =>
  ({ OR: [{ status: { not: "draft" } }, { creatorId: userId }] })

const absenceWhereFromFilters = ({ assigneeId, creatorId }: AbsenceListFilters): Prisma.AbsenceWhereInput => ({
  AND: [
    assigneeId === undefined ? {} : { assigneeId },
    creatorId === undefined ? {} : { creatorId },
  ],
})

const absenceWhereFromVisibility = (visibility: AbsenceVisibility): Prisma.AbsenceWhereInput =>
  AbsenceVisibility.$match(visibility, {
    AllAbsences: () => ({}),
    OrganizationAbsences: ({ userId }) => nonDraftOrCreatedByWhere(userId),
    InvolvedAbsences: ({ userId, relatedUserIds }) => ({
      AND: [
        nonDraftOrCreatedByWhere(userId),
        { OR: [{ creatorId: userId }, { assigneeId: userId }, { assigneeId: { in: [...relatedUserIds] } }] },
      ],
    }),
  })
…
    getAbsenceById: Effect.fn("PrismaAbsenceViews.getAbsenceById")(function* ({ organizationId, visibility, absenceId }) {
      // Not visible = no row = AbsenceNotFoundError; any other Prisma error dies.
      const row = yield* prisma.absence.findUniqueOrThrow({
        where: { id: absenceId, organizationId, AND: [absenceWhereFromVisibility(visibility)] },
        select: absenceViewSelect,
      }).pipe(
        Effect.catchTag(
          "PrismaRecordNotFoundError",
          () => new AbsenceNotFoundError({ absenceId }),
          (error) => Effect.die(error),
        ),
      )
      return yield* decodeAbsenceView(row)
    }),
    listAbsences: Effect.fn("PrismaAbsenceViews.listAbsences")(function* ({ organizationId, visibility, filters }) {
      const rows = yield* prisma.absence.findMany({
        where: { organizationId, AND: [absenceWhereFromFilters(filters), absenceWhereFromVisibility(visibility)] },
```

- The adapter maps each filter and the visibility to a `where` (`absenceWhereFromFilters`, `absenceWhereFromVisibility`): port names never reach Prisma unmapped. It only translates; `absenceVisibilityFromReader` and the system callers choose the visibility.
- Reshape rows (`id → absenceId`, `Date → dateTimeUtcFromDate`) and `Schema.decodeEffect(AbsenceView)`; a decode failure dies.
