# HTTP

`http/absence-api.ts` (endpoints), `absence-http-errors.ts`, `absence-permissions.ts` ([access.md](access.md)), `absence-controller.ts`.

## Organization middleware

Example tenant check for an organization-scoped host; port it to the host's auth and tenant mechanism.

```ts
// lib/organization-member-middleware.ts
class NotOrganizationMemberHttpError extends Schema.TaggedError<NotOrganizationMemberHttpError>()("NotOrganizationMemberHttpError", {
  message: Schema.String.pipe(withConstructorDefault(() => "You're not a member of this organization.")),
}, { httpApiStatus: 403 }) {}

class OrganizationMemberMiddleware extends HttpApiMiddleware.Service<OrganizationMemberMiddleware, {
  readonly requires: CurrentUser       // from AuthMiddleware: { userId, permissions }
  readonly provides: CurrentActor      // { userId, organizationId, permissions }
}>()("OrganizationMemberMiddleware", { error: NotOrganizationMemberHttpError }) {}

// shared by the middleware and every endpoint's params
export const OrganizationPathParams = Schema.Struct({ organizationId: OrganizationId })

OrganizationMemberMiddleware.layer = Layer.effect(OrganizationMemberMiddleware, Effect.gen(function* () {
  const organizationMembers = yield* OrganizationMembers
  return Effect.fnUntraced(function* (handler) {
    const { organizationId } = yield* HttpRouter.schemaPathParams(OrganizationPathParams).pipe(Effect.orDie)
    const currentUser = yield* CurrentUser
    if (!(yield* organizationMembers.isOrganizationMember({ organizationId, userId: currentUser.userId })))
      return yield* new NotOrganizationMemberHttpError()
    return yield* handler.pipe(Effect.provideService(CurrentActor, { ...currentUser, organizationId }))
  })
}))

HttpApiGroup.make("absences").add(/* endpoints */)
  .prefix("/organizations/:organizationId")
  .middleware(OrganizationMemberMiddleware)
```

- A middleware can't see the endpoint's decoded params, so it decodes the route params itself with the shared `OrganizationPathParams`.
- Handlers read `currentActor.organizationId`. Clients never send `actorId` or capabilities.
- `NotOrganizationMemberHttpError` is the only HTTP error not derived from a domain error.

## Endpoints

| Endpoint | Name | Success |
|---|---|---|
| `POST /absences` `{ absenceId?, assigneeId, from, to }` | `createAbsence` | 201 + `Location` + view |
| `PUT /absences/:absenceId/period` `{ from, to }` | `rescheduleAbsence` | 200 view |
| `POST /absences/:absenceId/archive` | `archiveAbsence` | 200 view |
| `DELETE /absences/:absenceId` | `deleteAbsence` | 204 |
| `GET /absences/:absenceId` | `getAbsenceById` | 200 view |
| `GET /absences?assigneeId=&creatorId=` | `listAbsences` | 200 view[] |

- Endpoint names are the use case or view names.
- A command answers with the view, read back with the same actor as reader. Delete reads nothing.
- List filters are query params (`urlParams`), not nested routes.
- Instants travel as ISO strings through `Schema.DateTimeUtc`'s JSON codec; no separate HTTP date schema.
- Each endpoint declares its HTTP errors in check order: not found → wrong state → actor → policy / value → concurrency.

## HTTP errors

```ts
class AbsenceNotFoundHttpError extends Schema.TaggedError<AbsenceNotFoundHttpError>()("AbsenceNotFoundHttpError", {
  message: Schema.String.pipe(withConstructorDefault(() => "This absence doesn't exist or isn't visible to you.")),
}, { httpApiStatus: 404 }) {}
```

- One `Schema.TaggedError` per domain error, with a status and a default actionable `message`. No codes: the `_tag` identifies it.
- Fields: `message` only. Add a field only when the client needs it to act (`editableUntil`); never internal ids or actor data.
- Status: not found / invisible 404; not allowed 403; invalid value or referenced entity 422; wrong state, closed window, race, existing id 409.
- `toAbsenceHttpError(error)`: an exhaustive `Match.valueTags` over `AbsenceError`, so a new domain error doesn't compile until it has a variant. Its return type is a distributive conditional type, so a handler's error type is exactly the variants of its domain errors.

## Controller

```text
AbsenceController.archiveAbsence(params)
├─ UserRelationships.listRelatedUserIds({ organizationId, userId })        → relatedUserIds (once per request)
├─ absenceActorFromCurrentActor({ currentActor, relatedUserIds })           → AbsenceActor
├─ ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
├─ AbsenceViews.getAbsenceById({ organizationId, reader: actor, absenceId }) → AbsenceView
└─ on failure: toAbsenceHttpError(domain error)
```

Retries and idempotency are decided here; the domain stays truthful:

```ts
archiveAbsenceService.archiveAbsence(command).pipe(
  Effect.catchTag("AbsenceAlreadyArchivedError", () => Effect.void),   // retry of a finished archive: read back, 200
)
```

A create retried with the same client id catches `AbsenceAlreadyExistsError` and reads back; visibility decides whether that is 200 (same creator) or 404 (someone else's id).
