// Effect 3 — repository.md

// announcement-visibility.server.ts — shared base: which rows exist for a caller
export const announcementInOrganization = (organizationId: AuthorizedOrganizationId) =>
  ({ organizationId }) satisfies Prisma.AnnouncementWhereInput

// announcement-row.server.ts — shared base: one select and one decoder for the state
export const announcementStateSelect = { … } satisfies Prisma.AnnouncementSelect
export const decodeAnnouncement = (row: unknown) =>
  Schema.decodeUnknown(Announcement)(row).pipe(Effect.orDie)

// announcement-repository.server.ts
findAnnouncementById: Effect.fn('AnnouncementRepository.findAnnouncementById')(function* (organizationId, announcementId) {
  const row = yield* prisma.use((client) =>
    client.announcement.findFirst({
      where: { id: announcementId, ...announcementInOrganization(organizationId) },
      select: announcementStateSelect,
    }),
  )
  if (row === null) return yield* new AnnouncementNotFoundError({ announcementId })
  return yield* decodeAnnouncement(row)
}),

publishAnnouncement: Effect.fn('AnnouncementRepository.publishAnnouncement')(function* (draft: DraftAnnouncement, by) {
  const row = yield* prisma.use((client) =>
    client.announcement.update({
      where: { id: draft.id, organizationId: draft.organizationId, status: 'draft' }, // race guard
      data: { status: 'published', publishedAt: by.publishedAt, publishedById: by.actorId },
      select: announcementStateSelect,
    }),
  ).pipe(handlePrismaNotFound(() => new AnnouncementNotDraftError({ announcementId: draft.id })))
  return yield* decodeAnnouncement(row)
}),
