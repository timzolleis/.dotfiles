// Effect 3 — http-edge.md

// announcement-api-group.ts — the wire contract, shared by client and server

// explicit wire fields; Type accepts the domain value
export const PublishedAnnouncementResponse = Schema.Struct({
  status: Schema.Literal('published'),
  id: AnnouncementId,
  title: Schema.String,
  publishedAt: Schema.Date, // Date ↔ ISO string
})

// the wire form of a domain error
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

HttpApiEndpoint.post('publishAnnouncement', '/announcements/:announcementId/publish')
  .setPath(AnnouncementPath)
  .addSuccess(AnnouncementResponse)
  .addError(AnnouncementNotFoundHttpError)
  .addError(AnnouncementNotDraftHttpError)

// announcement-api-group.server.ts — handlers; a second file because only the server reads it
.handle('publishAnnouncement', ({ path }) =>
  Effect.gen(function* () {
    const organizationId = yield* policy.canManageAnnouncements(path.organizationId)
    const user = yield* AuthenticatedUser
    return yield* announcementService.publishAnnouncement({ organizationId, announcementId: path.announcementId, actorId: user.id })
  }).pipe(Effect.annotateSpans({ 'organization.id': path.organizationId, 'announcement.id': path.announcementId })),
)
