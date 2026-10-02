# HTTP edge

Handlers wire a request to one read or one command. The endpoint's codecs own every wire shape, so domain types never learn how they are serialized.

## Sketch

```ts
// announcement-response.ts — explicit wire fields; Type accepts the domain value
export const PublishedAnnouncementResponse = Schema.Struct({
  status: Schema.Literal('published'),
  id: AnnouncementId,
  title: Schema.String,
  publishedAt: Schema.Date, // Date ↔ ISO string
})

// announcement-http-errors.ts — the wire form of a domain error
/** Encodes `AnnouncementNotDraftError`; handlers fail with the domain error, never construct this. */
export const AnnouncementNotDraftHttpError = Schema.transform(
  Schema.TaggedStruct('AnnouncementNotDraftError', { announcementId: AnnouncementId, message: Schema.String }),
  Schema.instanceOf(AnnouncementNotDraftError),
  {
    strict: true,
    decode: ({ announcementId }) => new AnnouncementNotDraftError({ announcementId }),
    encode: (error) => ({ _tag: 'AnnouncementNotDraftError' as const, announcementId: error.announcementId, message: error.message }),
  },
).annotations(HttpApiSchema.annotations({ status: 409 }))

// announcement-api-group.ts
HttpApiEndpoint.post('publishAnnouncement', '/announcements/:announcementId/publish')
  .setPath(AnnouncementPath)
  .addSuccess(AnnouncementResponse)
  .addError(AnnouncementNotFoundHttpError)
  .addError(AnnouncementNotDraftHttpError)

// announcement-api-group.server.ts
.handle('publishAnnouncement', ({ path }) =>
  Effect.gen(function* () {
    const organizationId = yield* policy.canManageAnnouncements(path.organizationId)
    const user = yield* AuthenticatedUser
    return yield* announcementService.publishAnnouncement({ organizationId, announcementId: path.announcementId, actorId: user.id })
  }).pipe(Effect.annotateSpans({ 'organization.id': path.organizationId, 'announcement.id': path.announcementId })),
)
```

## Rules

- **A handler is decode → policy → one call → return the domain value.** No mapping, no `catchTags`, no decisions.
- **Questions call the repository; commands call the service.**
- **`*Response` schemas declare their wire fields explicitly.** The handler returns the domain value; `HttpApi` encodes it and drops fields the response does not declare. When the domain renames or drops a field, the response's `Type` stops accepting it and `tsc` fails.
- **Use a transform in a `*Response` only when the wire shape differs** from the domain shape (flattening a read model), following [decoding.md](decoding.md).
- **`*HttpError` is a codec over the domain error**: wire struct → `Schema.instanceOf(DomainError)`, with the status annotation on the transform. Handlers fail with domain errors; each endpoint lists the `*HttpError` codecs it can produce.
- **Request schemas decode into commands and branded IDs.** Do not rebrand decoded IDs later.
- **Name by role**: `*Response` for success shapes, `*HttpError` for error codecs. No `Json` or `Dto` suffixes.

## Trade-offs

- Explicit response fields state each wire field twice, once in the domain and once at the edge; `tsc` keeps them in step, and the HTTP contract never changes silently with the domain.
- Error codecs replace per-handler `catchTags`, but an endpoint with several error codecs depends on `HttpApi` choosing the matching `instanceOf` member. Verify that encoding and the OpenAPI output once per codebase before relying on it.
- A client that decodes responses with the same API schema receives domain types.
