# Access

Who may act, and who sees what. Always the actor model; no permission gates.

## Organization scope

- The route carries the organization (`/organizations/:organizationId/…`); `OrganizationMemberMiddleware` checks membership before any handler runs ([http.md](http.md)).
- The repository's and views' `where (id, organizationId)` enforces scope once. Don't repeat it in the domain.
- The actor has no `organizationId`, and flag names don't say "InOrganization": the controller computes every flag for the route's organization, and every find the actor reaches is scoped to it.

## Actor

```ts
// domain/absence-actor.ts
type AbsenceActor = {
  readonly userId: UserId
  readonly mayEditOthersAbsences: boolean        // reschedule, reassign, archive someone else's active absence
  readonly mayDeleteOthersAbsences: boolean
  readonly mayAssignAnyone: boolean              // not only self or related users
  readonly mayReadOthersAbsences: boolean        // see absences the actor isn't involved in
  readonly relatedUserIds: ReadonlySet<UserId>   // loaded once per request
}
```

- One actor per core type: `userId`, capability flags, and facts about the actor loaded per request.
- Flags name capabilities, not roles: capabilities are granted per person, so no role name fits.
- A permission becomes a flag; a policy or the visibility rule decides. A gate would turn "creator OR permission" into "creator AND permission". A pure capability (export) costs one flag plus a one-line policy.
- Never build a fake actor with every flag set for a job; give the system intent its own actor-less transition.

## Permission translation

```ts
// http/absence-permissions.ts — the only place that reads the absence permission keys; pure
AbsencePermission = Schema.Literals(["absences:read", "absences:update", "absences:delete"])

absenceActorFromCurrentActor({ currentActor, relatedUserIds }) → AbsenceActor = {
  userId: currentActor.userId, relatedUserIds,
  mayEditOthersAbsences:   has("absences:update"),
  mayDeleteOthersAbsences: has("absences:delete"),
  mayAssignAnyone:         has("absences:update"),
  mayReadOthersAbsences:   has("absences:read") || has("absences:update"),   // edit implies read
}
// has(key) = currentActor.permissions.hasPermission(key, currentActor.organizationId)
```

- The domain never sees a permission key or `CurrentActor`.
- Identity/access owns roles and the role → permission mapping; the module owns its keys and the translation.
- The controller loads actor facts (`UserRelationships.listRelatedUserIds`) once per request. Use cases never call those ports.

## Reader

The views take only the actor's read fields:

```ts
type AbsenceReader = Pick<AbsenceActor, "userId" | "mayReadOthersAbsences" | "relatedUserIds">
```

HTTP builds one actor and passes it to both sides (`reader: actor`). A read-only principal (feed token, support "view as", another module) builds only a reader, which no transition accepts.

| Situation | Pick |
|---|---|
| Default: reads and writes use the same principal and the same loaded facts | derived reader (`Pick<Actor, …>`) |
| One request needs both rules (`canEdit` in a response, 404 for commands on invisible rows) | derived reader |
| Read-only principals exist (feed, guest link, impersonation, another module) | derived reader: they build only the picked fields |
| The read side needs different facts than the write side, or loading the write facts is too expensive for reads | separate types |
| The reader is not the same kind of principal (no `userId`, e.g. a feed token scoped to one assignee) | separate types |

## Visibility

The read rule is data, defined once; the views adapter translates it into its query ([reads.md](reads.md)).

```ts
type AbsenceVisibility = Data.TaggedEnum<{
  AllAbsences: {}
  InvolvedAbsences: { readonly userId: UserId; readonly relatedUserIds: ReadonlySet<UserId> }
}>
const AbsenceVisibility = Data.taggedEnum<AbsenceVisibility>()

createAbsenceVisibilityForReader(reader: AbsenceReader) → AbsenceVisibility
  // mayReadOthersAbsences → AllAbsences
  // else InvolvedAbsences: creator, assignee, or assignee ∈ relatedUserIds
  // both: others' drafts stay hidden
```

- `Data.TaggedEnum`, not a schema: it is never decoded or encoded.
- Filter, never reject: an invisible absence is `AbsenceNotFoundError` (404, doesn't reveal it exists); a filter on an unrelated user returns `[]`.
