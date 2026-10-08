// Effect 4 — service.md

export declare namespace AnnouncementService {
  export interface Service {
    /** A republish keeps the original publication and only re-emits the event. */
    readonly publishAnnouncement: (args: {
      readonly organizationId: AuthorizedOrganizationId
      readonly announcementId: AnnouncementId
      readonly actorId: UserId
    }) => Effect.Effect<Announcement, AnnouncementNotFoundError | AnnouncementNotDraftError>
    readonly markAnnouncementViewed: AnnouncementRepository.Service['markAnnouncementViewed']
  }
}

export class AnnouncementService extends Context.Service<AnnouncementService, AnnouncementService.Service>()(
  'AnnouncementService',
) {
  static readonly make = Effect.gen(function* () {
    const announcementRepository = yield* AnnouncementRepository
    const eventClient = yield* EventClient

    return AnnouncementService.of({
      publishAnnouncement: Effect.fn('AnnouncementService.publishAnnouncement')(function* ({ organizationId, announcementId, actorId }) {
        const announcement = yield* announcementRepository.findAnnouncementById(organizationId, announcementId)
        if (announcement.status === 'published') {
          yield* eventClient.publish(AnnouncementPublishedEvent.fromAnnouncement(announcement))
          return announcement
        }
        const publishedAt = yield* DateTime.nowAsDate
        const published = yield* announcementRepository.publishAnnouncement(announcement, { actorId, publishedAt })
        yield* eventClient.publish(AnnouncementPublishedEvent.fromAnnouncement(published))
        return published
      }),
      markAnnouncementViewed: announcementRepository.markAnnouncementViewed, // no rule yet: pass-through
    })
  })

  static readonly layerNoDeps = Layer.effect(AnnouncementService, AnnouncementService.make)
  static readonly layer = AnnouncementService.layerNoDeps.pipe(
    Layer.provide([AnnouncementRepository.layer, EventClient.layer]),
  )
}
