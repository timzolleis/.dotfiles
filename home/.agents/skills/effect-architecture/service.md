# Service

The use cases whose subject is one core type. A service method reads as a short business story: read → decide → transition → side effects.

## Sketch

```ts
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

export class AnnouncementService extends Context.Tag('AnnouncementService')<
  AnnouncementService,
  AnnouncementService.Service
>() {
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
```

## Rules

- **Apply the service test** ([vocabulary.md](vocabulary.md)) before creating one. A module that only computes is a policy.
- **Declare the interface; infer the rest.** The `Service` interface is the list of use cases and the first thing a reader opens. `make` and `layerNoDeps` carry no type annotations: write methods inline in `.of({ … })`, which infers their arguments and checks their returns against the interface.
- **Yield stable dependencies once in `make`** and close over them. `layerNoDeps` leaves them required; `layer` provides the production ones.
- **Every command goes through the service.** A command with no rule yet is a one-line reference to the repository transition; it grows into a `function*` without changing callers.
- **Decide with `if` or `Match` on the state, and call policies for computed values.** No plan types.
- **Order side effects after the transition commits.** An event is a past-tense fact; publish it after the write it describes.
- **Name the consistency boundary** when a use case changes several aggregates or external systems: what can be partially complete, what is retry-safe.
- A helper shared by several methods is defined above `.of` with an explicit type.

## Spans

- `Effect.fn('Service.method')` names every span.
- Set IDs once, at the entry point, with `Effect.annotateSpans({ 'organization.id': …, 'announcement.id': … })`. Every span below it inherits them, so methods never call `annotateCurrentSpan` for inputs they received.
- Entry points are handlers, event subscribers, and jobs; each annotates its own IDs.
- Annotate values a span produces (counts, minted IDs). Never record personal data.

## Trade-offs

- Inferred `make`: a missing dependency fails at `layer`, and the dependency list is the `yield*` lines.
- Annotating at the edge: an entry point that forgets leaves every span below it without IDs.
- Pass-through lines keep "every command through the service" true at the cost of one line each.
