// Effect 4 — decoding.md

// Instants: Schema.Date = Date instance (domain, rows); Schema.DateFromString = Date ↔ ISO string (text edges).
// v3's Schema.Date was the ISO-string codec; in v4 it still type-checks but expects a Date instance.

// 1. Same shape → decode directly
// typed: the Prisma payload is assignable to the schema's Encoded side, so column drift fails tsc
const decodeTemplate = Schema.decodeEffect(CustomNotificationTemplate)
// untyped: lifecycle unions with per-state nullable columns, Json columns, $queryRaw
const decodeAnnouncement = Schema.decodeUnknownEffect(Announcement)

// 2. Only field representations differ → field codecs
export const AnnouncementRecipientResponse = Schema.Struct({
  userId: UserId,
  notifiedAt: Schema.DateFromString,                        // Date ↔ ISO string
  viewedAt: Schema.OptionFromNullOr(Schema.DateFromString),  // Option ↔ null
})

// 3. The shape differs → one declared transform; the target is the domain type's type side
export const AnnouncementInboxEntryFromRow = Schema.Struct({
  ...PublishedAnnouncement.fields,
  recipients: Schema.Tuple([Schema.Struct({ viewedAt: Schema.NullOr(Schema.Date) })]),
}).pipe(
  Schema.decodeTo(
    Schema.toType(AnnouncementInboxEntry),
    SchemaTransformation.transform({
      decode: ({ recipients: [recipient], ...announcement }) => ({ announcement, viewedAt: Option.fromNullOr(recipient.viewedAt) }),
      encode: ({ announcement, viewedAt }) => ({ ...announcement, recipients: [{ viewedAt: Option.getOrNull(viewedAt) }] }),
    }),
  ),
).annotate({ identifier: 'AnnouncementInboxEntryFromRow' })

// One-way edge: getters instead of SchemaTransformation.transform
Schema.decodeTo(Schema.toType(AnnouncementInboxEntry), {
  decode: SchemaGetter.transform(({ recipients: [recipient], ...announcement }) => ({ announcement, viewedAt: Option.fromNullOr(recipient.viewedAt) })),
  encode: SchemaGetter.forbidden(() => 'AnnouncementInboxEntryFromRow is decode-only'),
})

// Nested decode inside a transform: SchemaGetter.transformEffect over Schema.decodeEffect, never Schema.decodeSync
