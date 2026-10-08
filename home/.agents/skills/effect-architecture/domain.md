# Domain

States, read models, errors, and policies of one core type. No Effect services, no I/O, no transport.

Example: `examples/v<major>/domain.ts` — states, a read model, an error, a policy.

## Rules

- **States are type-only schemas**: the `Date`-instance schema, branded IDs, one literal per member on `status`. They describe values; each edge brings the codec that serializes them.
- **Model the lifecycle as a union**, one struct per state, with the fields that state guarantees. A field that exists only in some states lives only in those members.
- **Read models nest states** and add only context the state does not own (`viewedAt`, attachments, counts). Name them for the question they answer. They live with the core type they are *about*: the one they nest or are keyed by.
- **Errors are `Data.TaggedError`**, named `*Error`, with the semantic fields and a `message` getter that starts with a unique literal. They carry no status and no schema.
- **Policies are plain functions** over existing domain types, in a file named after the question (`announcement-revision.ts`). They return domain values, never plans or diffs for a service to unpack.
- **Services decide; the domain does not orchestrate.** Extract a rule from a service into a policy when a second use case needs it, or when its cases deserve a table test. Otherwise it stays an `if` or `Match` in the service.
- **Derive within the domain family** (spread `...DraftAnnouncement.fields`, pick fields). Never derive edge shapes from domain fields.

## Trade-offs

- No decider or plan types: a rule that chooses which effects run reads once, in the service. Cost: testing that rule goes through the service with fakes, unless it is extracted as a policy.
- Composition over spreading: a read model cannot pass as a state in a transition, and the shared state decoder decodes it unchanged. Cost: `entry.announcement.title`, and flat wire shapes flatten at the edge.
- `Data.TaggedError` keeps the domain unserializable. Cost: an error crossing a non-HTTP edge (a queue, a worker) needs its own codec there too; older `Schema.TaggedError` errors migrate when touched.
