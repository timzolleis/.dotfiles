# Decoding

Every edge owns a codec, `Schema<DomainType, EdgeShape>`. Write the least code the representation change allows.

Example: `examples/v<major>/decoding.ts` — one block per ladder step, the instant spellings, a one-way transform.

## The ladder

1. **Same shape → decode directly.** No row schema, no mapper. The typed decoder checks the Prisma payload against the schema's Encoded side, so column drift fails `tsc`; the unknown decoder serves lifecycle unions with per-state nullable columns, Json columns, and `$queryRaw`.
2. **Only field representations differ → field codecs.** The struct keeps its field names (`Date ↔ ISO string`, `Option ↔ null`).
3. **The shape differs → one declared transform at the edge.** Renaming, nesting, flattening.
4. **It needs I/O or a rule → not a codec.** That is a service or a policy.

## Rules

- **Decode at every edge**: HTTP requests, rows, stored JSON, events, environment, third-party responses. Inside, code receives valid domain values.
- **Climb the ladder only as far as the change requires.** A transform is a mapper in schema plumbing; it pays off when one transform serves a shape several methods share.
- **In a transform, the source owns the edge shape and the target is the type side of the domain schema.** Decode nested values effectfully inside a transform so failures stay parse issues; never call a throwing `*Sync` decoder there.
- **Instants**: the `Date`-instance schema in the domain and in rows; the ISO-string codec only where the edge serializes to text (HTTP, events, stored JSON). `IsoDate` for calendar dates. The names swap between versions; take them from the example.
- **Pin the discriminator to the column name** (`status`) so rows decode into the union directly.
- **Annotate `identifier`** on unions, members, and transforms decoded at runtime, so parse errors name them. Keep stock parse-error trees.
- **Construct brands with `.make`, never cast**, and only where a new invariant is established. Already-decoded fields are returned as plain objects typed by the target.

## Trade-offs

- Decoding a lifecycle union with the unknown decoder gives up compile-time column checks; a database `CHECK` constraint keeps per-state nullability honest.
- A transform needs an `encode` even on a one-way edge; write the inverse when cheap, otherwise make encoding fail as forbidden.
