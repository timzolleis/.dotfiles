# Views

A view is what a client reads. Views bypass the model and the repository: a views port returns view schemas straight from storage, filtered by a visibility. Nothing on the write side reads a view.

```ts
// view/absence-views.ts
AbsenceView = Schema.Struct({
  absenceId, creatorId, assigneeId, from, to, createdAt,
  status: Schema.Literals(["draft", "active", "archived"]),
  activatedAt: Schema.NullOr(Schema.DateTimeUtc), archivedAt: Schema.NullOr(Schema.DateTimeUtc),
})

class AbsenceViews extends Context.Service<AbsenceViews, {
  getAbsenceById({ organizationId, visibility, absenceId }):             Effect<AbsenceView, AbsenceNotFoundError>   // not visible = not found
  listAbsences({ organizationId, visibility, assigneeId?, creatorId? }): Effect<ReadonlyArray<AbsenceView>>         // filters AND, then visibility
}>()("AbsenceViews") {}
```

- Every method requires a visibility ([access.md](access.md)), so no read skips the read rule, including a command's read-back. A system read passes `AllAbsences()`.
- `get…` / `list…` are views; `find…` is the repository. Grepping `AbsenceById` finds both.
- The view is the API response schema. It holds only what the API shows (no `organizationId`: every request is scoped). Split off a response type + one mapping function only when a second consumer reads the view or the API needs a versioned contract.

## Adapter

```ts
// private to PrismaAbsenceViews, used by every query
absenceWhereFromVisibility(visibility) = AbsenceVisibility.$match(visibility, {
  AllAbsences:          () => ({}),
  OrganizationAbsences: ({ userId }) => hideOthersDraftsWhere(userId),
  InvolvedAbsences:     ({ userId, relatedUserIds }) => ({ AND: [
    hideOthersDraftsWhere(userId),
    { OR: [{ creatorId: userId }, { assigneeId: userId }, { assigneeId: { in: [...relatedUserIds] } }] }] }),
})
hideOthersDraftsWhere = (userId) => ({ OR: [{ status: { not: "draft" } }, { creatorId: userId }] })
```

- The adapter only translates the visibility; `absenceVisibilityFromReader` and the system callers choose it.
- Reshape rows (`id → absenceId`, `Date → dateTimeUtcFromDate`) and `Schema.decodeEffect(AbsenceView)`; a decode failure dies.
