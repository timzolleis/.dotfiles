# Decoding

Every edge owns a codec, `Schema<DomainType, EdgeShape>`. Write the least code the representation change allows.

## The ladder

**1. Same shape → decode directly.** No row schema, no mapper.

```ts
// typed: the Prisma payload is assignable to the schema's Encoded side, so column drift fails tsc
const decodeTemplate = Schema.decode(CustomNotificationTemplate)
// untyped: lifecycle unions with per-state nullable columns, Json columns, $queryRaw
const decodeAnnouncement = Schema.decodeUnknown(Announcement)
```

**2. Only field representations differ → field codecs.** The struct keeps its field names.

```ts
export const AnnouncementRecipientResponse = Schema.Struct({
  userId: UserId,
  notifiedAt: Schema.Date,                        // Date ↔ ISO string
  viewedAt: Schema.OptionFromNullOr(Schema.Date),  // Option ↔ null
})
```

**3. The shape differs → one declared transform at the edge.** Renaming, nesting, flattening.

```ts
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
)
```

**4. It needs I/O or a rule → not a codec.** That is a service or a policy.

## Rules

- **Decode at every edge**: HTTP requests, rows, stored JSON, events, environment, third-party responses. Inside, code receives valid domain values.
- **Climb the ladder only as far as the change requires.** A transform is a mapper in schema plumbing; it pays off when one transform serves a shape several methods share.
- **In a transform, the source owns the edge shape and the target is `Schema.typeSchema(DomainType)`.** Use `ParseResult.decode`/`encode` inside a transform, never `decodeSync`.
- **Edge shapes are declared, not derived from domain fields**, except persistence rows, which may spread domain fields where the stored representation is identical.
- **Instants**: `Schema.DateFromSelf` in the domain and in rows; `Schema.Date` only where the edge serializes to text (HTTP, events, stored JSON). `IsoDate` for calendar dates.
- **Pin the discriminator to the column name** (`status`) so rows decode into the union directly.
- **Annotate `identifier`** on unions, members, and transforms decoded at runtime, so parse errors name them. Keep stock parse-error trees.
- **Construct brands with `.make`, never cast**, and only where a new invariant is established. Already-decoded fields are returned as plain objects typed by the target.

## Trade-offs

- Decoding a lifecycle union with `decodeUnknown` gives up compile-time column checks; a database `CHECK` constraint keeps per-state nullability honest.
- Effect 3 transforms require an `encode` even on one-way edges; write the inverse when cheap, otherwise fail with `ParseResult.Forbidden`.
