# Reads

Reads bypass the model and the repository: a views port returns view schemas directly.

```ts
// view/absence-views.ts
AbsenceView = Schema.Struct({
  absenceId, creatorId, assigneeId, from, to, createdAt,
  status: Schema.Literals(["draft", "active", "archived"]),
  activatedAt: Schema.NullOr(Schema.DateTimeUtc), archivedAt: Schema.NullOr(Schema.DateTimeUtc),
})

class AbsenceViews extends Context.Service<AbsenceViews, {
  getAbsenceById({ organizationId, reader, absenceId }):             Effect<AbsenceView, AbsenceNotFoundError>   // not visible = not found
  listAbsences({ organizationId, reader, assigneeId?, creatorId? }): Effect<ReadonlyArray<AbsenceView>>         // filters AND, then visibility
}>()("AbsenceViews") {}
```

- Every method requires a reader ([access.md](access.md)), so no read skips visibility, including a command's read-back.
- `get…` / `list…` are views; `find…` is the repository. Grepping `AbsenceById` finds both.
- The view is the API response schema. It holds only what the API shows (no `organizationId`: every request is scoped). Split off a response type + one mapping function only when a second consumer reads the view or the API needs a versioned contract.
- One list per collection, with optional filters that combine with AND; no nested routes like `/people/:id/absences`.

## Adapter

```ts
// private to PrismaAbsenceViews, used by every query
createAbsenceVisibilityWhere(reader) = {
  AND: [
    { OR: [{ status: { not: "draft" } }, { creatorId: reader.userId }] },   // others' drafts hidden
    AbsenceVisibility.$match(createAbsenceVisibilityForReader(reader), {
      AllAbsences:      () => ({}),
      InvolvedAbsences: ({ userId, relatedUserIds }) => ({ OR: [
        { creatorId: userId }, { assigneeId: userId }, { assigneeId: { in: [...relatedUserIds] } }] }),
    }),
  ],
}
```

- The adapter only translates the rule; `createAbsenceVisibilityForReader` defines it.
- Reshape rows (`id → absenceId`, `Date → dateTimeUtcFromDate`) and `Schema.decodeEffect(AbsenceView)`; a decode failure dies.
