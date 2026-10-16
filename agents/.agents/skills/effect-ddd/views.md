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

export class AbsenceViews extends Context.Service<AbsenceViews, {
  // not visible = not found
  getAbsenceById(input: {
    readonly organizationId: OrganizationId; readonly visibility: AbsenceVisibility; readonly absenceId: AbsenceId
  }): Effect.Effect<AbsenceView, AbsenceNotFoundError>
  // filters combine with AND, then visibility; an absent filter is no condition
  listAbsences(input: {
    readonly organizationId: OrganizationId; readonly visibility: AbsenceVisibility
    readonly assigneeId?: UserId; readonly creatorId?: UserId
  }): Effect.Effect<ReadonlyArray<AbsenceView>>
}>()("AbsenceViews") {}
```

- Every method requires a visibility ([access.md](access.md)), so no read skips the read rule, including a command's read-back. A system read passes `AllAbsences()`.
- `get…` / `list…` are views; `find…` is the repository. Grepping `AbsenceById` finds both.
- The view is the API response schema. It holds only what the API shows (no `organizationId`: every request is scoped). Split off a response type + one mapping function only when a second consumer reads the view or the API needs a versioned contract.

## Adapter

```ts
// absence/infrastructure/prisma-absence-views.ts
const nonDraftOrCreatedByWhere = (userId: UserId): Prisma.AbsenceWhereInput =>
  ({ OR: [{ status: { not: "draft" } }, { creatorId: userId }] })

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
    listAbsences: Effect.fn("PrismaAbsenceViews.listAbsences")(function* ({ organizationId, visibility, ...filters }) {
      const rows = yield* prisma.absence.findMany({
        where: { organizationId, ...filters, AND: [absenceWhereFromVisibility(visibility)] },
```

- The adapter only translates the visibility; `absenceVisibilityFromReader` and the system callers choose it.
- Reshape rows (`id → absenceId`, `Date → dateTimeUtcFromDate`) and `Schema.decodeEffect(AbsenceView)`; a decode failure dies.
