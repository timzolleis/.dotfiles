# HTTP

The HTTP edge translates between transport and the module: decode the request, build the actor with the permission adapter ([access.md](access.md)), call a use case or view, map domain errors to HTTP errors. Retries and idempotency are decided here.

Files: `http/absence-api.ts` (`AbsenceApi`, the endpoints), `absence-http-errors.ts`, `absence-controller.ts` (`AbsenceController`, the handlers). Exports are named after their file, never `*ApiGroup`.

## Organization middleware

Example tenant check for an organization-scoped host; port it to the host's auth and tenant mechanism.

```ts
// lib/organization-member-middleware.ts
export class NotOrganizationMemberHttpError extends Schema.TaggedError<NotOrganizationMemberHttpError>()("NotOrganizationMemberHttpError", {
  message: messageWithDefault("You're not a member of this organization."),
}, { httpApiStatus: 403 }) {}

// Shared by the middleware and every endpoint's params, so both decode the same key with the same schema.
export const OrganizationPathParams = Schema.Struct({ organizationId: OrganizationId })

export class OrganizationMemberMiddleware extends HttpApiMiddleware.Service<OrganizationMemberMiddleware, {
  requires: CurrentUser
  provides: CurrentActor
}>()("OrganizationMemberMiddleware", { error: NotOrganizationMemberHttpError }) {
  static layer = Layer.effect(OrganizationMemberMiddleware, Effect.gen(function* () {
    const organizationMembers = yield* OrganizationMembers
    return OrganizationMemberMiddleware.of(Effect.fnUntraced(function* (handler) {
      const { organizationId } = yield* HttpRouter.schemaPathParams(OrganizationPathParams).pipe(Effect.orDie)
      const currentUser = yield* CurrentUser
      if (!(yield* organizationMembers.isOrganizationMember({ organizationId, userId: currentUser.userId }))) {
        return yield* new NotOrganizationMemberHttpError()
      }
      return yield* handler.pipe(Effect.provideService(CurrentActor, { userId: currentUser.userId, permissions: currentUser.permissions, organizationId }))
    }))
  }))
}
```

- A middleware can't see the endpoint's decoded params, so it decodes the route params itself with the shared `OrganizationPathParams`.
- `CurrentUser` (`{ userId, permissions }`) comes from the host's auth middleware. Handlers read `currentActor.organizationId`.
- `NotOrganizationMemberHttpError` is the only HTTP error not derived from a domain error.

## Endpoints

| Endpoint | Name | Success |
|---|---|---|
| `POST /absences` `{ absenceId?, assigneeId, from, to }` | `createAbsence` | 201 view |
| `PUT /absences/:absenceId/period` `{ from, to }` | `rescheduleAbsence` | 200 view |
| `POST /absences/:absenceId/archive` | `archiveAbsence` | 200 view |
| `DELETE /absences/:absenceId` | `deleteAbsence` | 204 |
| `GET /absences/:absenceId` | `getAbsenceById` | 200 view |
| `GET /absences?assigneeId=&creatorId=` | `listAbsences` | 200 view[] |

- Endpoint names are the use case or view names.
- A command answers with the view, read back with the actor's visibility. Delete reads nothing.
- List filters are `query` params, not nested routes.
- Instants travel as ISO strings through `Schema.DateTimeUtc`'s JSON codec; no separate HTTP date schema.
- Each endpoint declares its HTTP errors in check order: not found → wrong state → actor → rule / value → concurrency.

```ts
// absence/http/absence-api.ts
const AbsencePathParams = Schema.Struct({ ...OrganizationPathParams.fields, absenceId: AbsenceId })
…
export class AbsenceApi extends HttpApiGroup.make("absences")
  .add(
    HttpApiEndpoint.post("createAbsence", "/absences", {
      params: OrganizationPathParams,
      payload: Schema.Struct({
        absenceId: Schema.optional(AbsenceId),
        assigneeId: UserId,
        from: Schema.DateTimeUtc,
        to: Schema.DateTimeUtc,
      }),
      success: AbsenceView.pipe(HttpApiSchema.status(201)),
      error: [
        AssigneeNotInOrganizationHttpError, NotAllowedToAssignAbsenceHttpError, InvalidPeriodHttpError, AbsenceAlreadyExistsHttpError,
        AbsenceNotFoundHttpError, // read-back, if the absence is deleted before it
      ],
    }),
    HttpApiEndpoint.post("archiveAbsence", "/absences/:absenceId/archive", {
      params: AbsencePathParams,
      success: AbsenceView,
      error: [
        AbsenceNotFoundHttpError, AbsenceStillDraftHttpError, AbsenceAlreadyArchivedHttpError,
        NotAllowedToEditAbsenceHttpError, AbsenceOngoingHttpError, AbsenceChangedConcurrentlyHttpError,
      ],
    }),
    // …one per use case and view, as in the table
    HttpApiEndpoint.get("listAbsences", "/absences", {
      params: OrganizationPathParams,
      query: { assigneeId: Schema.optionalKey(UserId), creatorId: Schema.optionalKey(UserId) },
      success: Schema.Array(AbsenceView),
    }),
  )
  // prefix and middleware apply only to endpoints added before them
  .prefix("/organizations/:organizationId")
  .middleware(OrganizationMemberMiddleware)
  .middleware(AuthMiddleware)
{}
```

## HTTP errors

```ts
// lib/message-with-default.ts
// The constructor fills in the default: `new AbsenceNotFoundHttpError()`.
export const messageWithDefault = (message: string) =>
  Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed(message)))
```

```ts
// absence/http/absence-http-errors.ts
export class AbsenceNotFoundHttpError extends Schema.TaggedError<AbsenceNotFoundHttpError>()("AbsenceNotFoundHttpError", {
  message: messageWithDefault("This absence doesn't exist or isn't visible to you."),
}, { httpApiStatus: 404 }) {}
```

- One `Schema.TaggedError` per domain error, with a status and a default actionable `message`. No codes: the `_tag` identifies it.
- Fields: `message` only. Add a field only when the client needs it to act (`editableUntil`); never internal ids or actor data.
- Status: not found / invisible 404; not allowed 403; invalid value or referenced entity 422; wrong state, closed window, race, existing id 409.

The mapper is `matchTag` ([repository.md](repository.md), Writes) with `Out` inferred:

```ts
// absence/http/absence-http-errors.ts
export const absenceHttpErrorFromAbsenceError = matchTag<AbsenceError>()({
  AbsenceNotFoundError: () => new AbsenceNotFoundHttpError(),
  // …one per domain error
})
```

- Each handler ends with `.pipe(Effect.mapError(absenceHttpErrorFromAbsenceError))`. Its errors infer `Tag` as the union of their tags, so its error type is exactly their HTTP variants, and the endpoint's `error: [...]` list is checked against it.
- Not `Match.valueTags`: it returns the union of all variants, so no endpoint that declares only its own compiles.

## Controller

```text
AbsenceController.archiveAbsence(params)
├─ UserRelationships.listRelatedUserIds({ organizationId, userId })
│    : Effect<ReadonlySet<UserId>>   → relatedUserIds, once per request
├─ absenceActorFromPermissions({ userId, organizationId, permissions, relatedUserIds }): AbsenceActor
├─ ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
│    : Effect<void, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError
│                 | NotAllowedToEditAbsenceError | AbsenceOngoingError | AbsenceChangedConcurrentlyError>
├─ AbsenceViews.getAbsenceById({ organizationId, visibility: absenceVisibilityFromReader(actor), absenceId })
│    : Effect<AbsenceView, AbsenceNotFoundError>
└─ any domain error → absenceHttpErrorFromAbsenceError(error)
```

```ts
// absence/http/absence-controller.ts
export const AbsenceController = HttpApiBuilder.group(Api, "absences", Effect.fn(function* (handlers) {
  const archiveAbsenceService = yield* ArchiveAbsenceService
  // …one per use case
  const absenceViews = yield* AbsenceViews
  const userRelationships = yield* UserRelationships

  // Once per request: the actor for commands, and the visibility for reads.
  const loadAbsenceActorAndVisibility = Effect.gen(function* () {
    const currentActor = yield* CurrentActor
    const relatedUserIds = yield* userRelationships.listRelatedUserIds({
      organizationId: currentActor.organizationId, userId: currentActor.userId,
    })
    const actor = absenceActorFromPermissions({
      userId: currentActor.userId, organizationId: currentActor.organizationId, permissions: currentActor.permissions, relatedUserIds,
    })
    return { organizationId: currentActor.organizationId, actor, visibility: absenceVisibilityFromReader(actor) }
  })

  return handlers.handleAll({
    archiveAbsence: ({ params }) => Effect.gen(function* () {
      const { organizationId, actor, visibility } = yield* loadAbsenceActorAndVisibility
      yield* archiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId: params.absenceId })
      return yield* absenceViews.getAbsenceById({ organizationId, visibility, absenceId: params.absenceId })
    }).pipe(Effect.mapError(absenceHttpErrorFromAbsenceError)),
    // …one per endpoint; a read skips the use case and the mapError when it can't fail
  })
}))
```

Retries and idempotency are decided here; the domain stays truthful:

```ts
// variant: a retry-safe archive, opt-in per endpoint
archiveAbsenceService.archiveAbsence(command).pipe(
  Effect.catchTag("AbsenceAlreadyArchivedError", () => Effect.void),   // retry of a finished archive: read back, 200
)
```

A create retried with the same client id catches `AbsenceAlreadyExistsError` and reads back; visibility decides whether that is 200 (same creator) or 404 (someone else's id).
