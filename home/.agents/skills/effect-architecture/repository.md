# Repository

The persistence adapter for one core type. It turns rows into domain types and transitions into guarded writes. Large is fine; logic is not.

Example: `examples/v<major>/repository.ts` — a visibility predicate, the shared select and decoder, a read, a guarded transition. `prisma.use` and `handlePrismaNotFound` stand for the repository's own Prisma service and error mapper; the repo `AGENTS.md` names the real ones.

## Rules

- **One repository per core type**, not per table or feature. A read belongs to the repository of the core type its answer is *about*, even when it counts another table's rows.
- **Reads return states or read models.** A plain list of states needs no read model.
- **Writes are named transitions** (`publishAnnouncement`, `editAnnouncementDraft`, `markAnnouncementViewed`) that take the source state and return the next state. Write only the fields the transition sets; Prisma's partial `data` is the diff.
- **Guard the source state in `where`.** Races are the repository's job: zero matched rows become the domain error the type implied.
- **Scope every query with a visibility predicate** from the shared base. Methods take `AuthorizedOrganizationId`, never a bare `OrganizationId`.
- **Decode into domain types at the end of every method**, following [decoding.md](decoding.md).
- **Map expected Prisma failures** (not found, unique violation) to domain errors here; everything else dies.
- **No decisions, events, or cross-feature calls.** A `where` guard is a persistence guarantee; the rule it protects is the transition's parameter type.
- **A `$transaction` requires a named atomicity decision** in the spec. Keep network calls outside it.

## Tenancy

Same in Effect 3 and 4:

```ts
export type AuthorizedOrganizationId = OrganizationId & Brand.Brand<'AuthorizedOrganizationId'>
const makeAuthorizedOrganizationId = Brand.nominal<AuthorizedOrganizationId>() // not exported

/** Only for system jobs acting without a user, such as event subscribers. */
export const trustAuthorizedOrganizationId = (id: OrganizationId) => makeAuthorizedOrganizationId(id)
```

Policies return `AuthorizedOrganizationId` after checking membership; `trustAuthorizedOrganizationId` is the reviewed escape hatch. It never gets a Schema, so no edge can decode into it. It is a safeguard against forgetting the policy, not a security boundary.

## Trade-offs

- One method per transition instead of a generic `update(changes)`. A combined command is two guarded writes, or its own transition when it must be atomic.
- Handlers may call reads directly but must send writes through a service; this holds by convention and review.
