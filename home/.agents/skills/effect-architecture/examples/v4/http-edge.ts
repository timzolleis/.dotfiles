// Effect 4 — http-edge.md

// announcement-response.ts — explicit wire fields; Type accepts the domain value
export const PublishedAnnouncementResponse = Schema.Struct({
  status: Schema.Literal('published'),
  id: AnnouncementId,
  title: Schema.String,
  publishedAt: Schema.DateFromString, // Date ↔ ISO string
})

// announcement-http-errors.ts — the wire form of a domain error
/** Encodes `AnnouncementNotDraftError`; handlers fail with the domain error, never construct this. */
export const AnnouncementNotDraftHttpError = Schema.TaggedStruct('AnnouncementNotDraftError', {
  announcementId: AnnouncementId,
  message: Schema.String,
}).pipe(
  Schema.decodeTo(
    Schema.instanceOf(AnnouncementNotDraftError),
    SchemaTransformation.transform({
      decode: ({ announcementId }) => new AnnouncementNotDraftError({ announcementId }),
      encode: (error) => ({ _tag: 'AnnouncementNotDraftError' as const, announcementId: error.announcementId, message: error.message }),
    }),
  ),
  HttpApiSchema.status(409), // same as .annotate({ httpApiStatus: 409 })
)

// announcement-api-group.ts
HttpApiEndpoint.post('publishAnnouncement', '/announcements/:announcementId/publish', {
  params: AnnouncementPath,
  success: AnnouncementResponse,
  error: [AnnouncementNotFoundHttpError, AnnouncementNotDraftHttpError],
})

// announcement-api-group.server.ts
.handle('publishAnnouncement', ({ params }) =>
  Effect.gen(function* () {
    const organizationId = yield* policy.canManageAnnouncements(params.organizationId)
    const user = yield* AuthenticatedUser
    return yield* announcementService.publishAnnouncement({ organizationId, announcementId: params.announcementId, actorId: user.id })
  }).pipe(Effect.annotateSpans({ 'organization.id': params.organizationId, 'announcement.id': params.announcementId })),
)
