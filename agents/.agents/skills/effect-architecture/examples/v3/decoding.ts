// Effect 3 — decoding.md

// Instants: Schema.DateFromSelf = Date instance (domain, rows); Schema.Date = Date ↔ ISO string (text edges)

// 1. Same shape → decode directly
// typed: the Prisma payload is assignable to the schema's Encoded side, so column drift fails tsc
const decodeTemplate = Schema.decode(CustomNotificationTemplate)
// untyped: lifecycle unions with per-state nullable columns, Json columns, $queryRaw
const decodeAnnouncement = Schema.decodeUnknown(Announcement)

// 2. Only field representations differ → field codecs
export const AnnouncementRecipientResponse = Schema.Struct({
  userId: UserId,
  notifiedAt: Schema.Date,                        // Date ↔ ISO string
  viewedAt: Schema.OptionFromNullOr(Schema.Date),  // Option ↔ null
})

// 3. The shape differs → one declared transform; the target is the domain type's type side
export const AnnouncementInboxEntryFromRow = Schema.transform(
  Schema.Struct({
    ...PublishedAnnouncement.fields,
    recipients: Schema.Tuple(Schema.Struct({ viewedAt: Schema.NullOr(Schema.DateFromSelf) })),
  }),
  Schema.typeSchema(AnnouncementInboxEntry),
  {
    strict: true,
    decode: ({ recipients: [recipient], ...announcement }) => ({ announcement, viewedAt: Option.fromNullable(recipient.viewedAt) }),
    encode: ({ announcement, viewedAt }) => ({ ...announcement, recipients: [{ viewedAt: Option.getOrNull(viewedAt) }] }),
  },
).annotations({ identifier: 'AnnouncementInboxEntryFromRow' })

// One-way edge: transformOrFail whose encode fails as forbidden
encode: (value, _, ast) => ParseResult.fail(new ParseResult.Forbidden(ast, value, 'AnnouncementInboxEntryFromRow is decode-only'))

// Nested decode inside a transform: ParseResult.decode / ParseResult.encode, never Schema.decodeSync
