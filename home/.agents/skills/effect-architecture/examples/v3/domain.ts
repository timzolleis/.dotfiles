// Effect 3 — domain.md

// announcement.ts — the Announcement domain module: states, read models, errors, policies

// states: type-only schemas (Encoded = Type)
export const DraftAnnouncement = Schema.Struct({
  status: Schema.Literal('draft'),
  id: AnnouncementId,
  organizationId: OrganizationId,
  title: Schema.String,
  content: AnnouncementContent,
  updatedAt: Schema.DateFromSelf, // instant: Date instance
}).annotations({ identifier: 'DraftAnnouncement' })

export const PublishedAnnouncement = Schema.Struct({
  ...DraftAnnouncement.fields,
  status: Schema.Literal('published'),
  publishedAt: Schema.DateFromSelf,
  publishedById: UserId,
}).annotations({ identifier: 'PublishedAnnouncement' })

export const Announcement = Schema.Union(DraftAnnouncement, PublishedAnnouncement)
export type Announcement = typeof Announcement.Type

// a read model nests the state
export const AnnouncementInboxEntry = Schema.Struct({
  announcement: PublishedAnnouncement,
  viewedAt: Schema.OptionFromSelf(Schema.DateFromSelf),
})

// plain errors, no codec
export class AnnouncementNotDraftError extends Data.TaggedError('AnnouncementNotDraftError')<{
  readonly announcementId: AnnouncementId
}> {
  override get message() {
    return `Announcement is not a draft: ${this.announcementId}`
  }
}

// a policy: a plain function over domain types
export const getAnnouncementRevision = (
  announcement: Announcement,
  edit: AnnouncementTextEdit,
  actorId: UserId,
): Option.Option<AnnouncementRevision> => …
