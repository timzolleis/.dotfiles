# Access

Access is who may act and who sees what: flags on the actor decide acting, a visibility rule decides seeing. The rules hold for any host; organizations, `CurrentActor`, permission keys, and `hasPermission` are the example mechanism: port them to the host's, and leave out what it doesn't have.

## No access model

The actor is `{ userId }`: no flags, permission adapter, reader, visibility, actor rule, or `NotAllowedTo…Error`. Transitions still take `actor`, and events still carry `actorId`, so adding access later only adds fields.

## Organization scope

Only in multi-tenant hosts; the organization is the example tenant.

- The route carries the organization (`/organizations/:organizationId/…`); `OrganizationMemberMiddleware` checks membership before any handler runs ([http.md](http.md)).
- The actor has no `organizationId`, and flag names don't say "InOrganization": the permission adapter computes every flag for the scoped organization, and every find the actor reaches is scoped to it.

## Actor

The actor is the domain's question: may this actor do X? Each flag is one question in the domain's words (`mayEditOthersAbsences`); a rule combines it with state and time. The domain never knows how a flag is answered.

```ts
// absence/domain/absence-actor.ts
// Capabilities, not a role. Every flag holds for the organization of the request.
export type AbsenceActor = {
  readonly userId: UserId
  readonly mayEditOthersAbsences: boolean        // reschedule, reassign, archive someone else's active absence
  readonly mayDeleteOthersAbsences: boolean      // delete someone else's active absence
  readonly mayAssignAnyone: boolean              // assign to any member, not only self or related users
  readonly mayReadOthersAbsences: boolean        // see absences the actor isn't involved in
  readonly relatedUserIds: ReadonlySet<UserId>   // loaded once per request
}
```

- One actor per core type: `userId`, capability flags, and facts about the actor loaded per request.
- Flags name capabilities, not roles: capabilities are granted per person, so no role name fits.
- A permission becomes a flag; a rule or the visibility rule decides. A gate would turn "creator OR permission" into "creator AND permission". A pure capability (export) costs one flag plus a one-line rule.

| Who triggers the intent | Actor |
|---|---|
| A user, synchronously (HTTP) | built per request by the permission adapter |
| A user, deferred (queued command, scheduled export) | rebuilt at run time from the persisted `userId`; permissions may have changed since enqueue |
| The system: time, rule, or another module's event | open: decide with the first real case (actor-less transition with its own rule list vs. an actor variant every rule handles). The trigger event's `actorId` is not this actor. |

Never build a user actor with every flag set for a job.

## Permission adapter

The host's permission system answers the actor's questions. One pure function per module is the only code that knows both sides: the host's permissions in, flags out.

```ts
// absence/infrastructure/absence-permissions.ts
export const AbsencePermission = Schema.Literals(["absences:read", "absences:update", "absences:delete"])
export type AbsencePermission = typeof AbsencePermission.Type

// The caller loads relatedUserIds once per request.
export const absenceActorFromPermissions = ({ userId, organizationId, permissions, relatedUserIds }: {
  readonly userId: UserId
  readonly organizationId: OrganizationId
  readonly permissions: Permissions
  readonly relatedUserIds: ReadonlySet<UserId>
}): AbsenceActor => {
  const hasAbsencePermission = (permission: AbsencePermission) => permissions.hasPermission(permission, organizationId)
  return {
    userId,
    relatedUserIds,
    mayEditOthersAbsences: hasAbsencePermission("absences:update"),
    mayDeleteOthersAbsences: hasAbsencePermission("absences:delete"),
    mayAssignAnyone: hasAbsencePermission("absences:update"),
    mayReadOthersAbsences: hasAbsencePermission("absences:read") || hasAbsencePermission("absences:update"),   // edit implies read
  }
}
```

- The domain never sees a permission key, role, or `CurrentActor`.
- Identity/access owns roles and role → permission; the module owns its keys and the adapter.
- A different permission system means a different adapter; flags, rules, and visibility stay.
- Whoever builds the actor loads its facts (`UserRelationships.listRelatedUserIds`) once; use cases never call those ports.

## Visibility

Writes take the actor; reads take a visibility, the read rule as data. Views never see an actor, so a read without a user states its visibility instead of faking one. The views adapter translates it into its query ([views.md](views.md)).

```ts
// absence/domain/absence-actor.ts
export type AbsenceReader = Pick<AbsenceActor, "userId" | "mayReadOthersAbsences" | "relatedUserIds">

export type AbsenceVisibility = Data.TaggedEnum<{
  AllAbsences: {}                                                   // system reads: jobs, listeners
  OrganizationAbsences: { readonly userId: UserId }                 // all, except others' drafts
  InvolvedAbsences: { readonly userId: UserId; readonly relatedUserIds: ReadonlySet<UserId> }
                                                                    // created, assigned, or assigned to a related user; except others' drafts
}>
export const AbsenceVisibility = Data.taggedEnum<AbsenceVisibility>()

export const absenceVisibilityFromReader = (reader: AbsenceReader): AbsenceVisibility =>
  reader.mayReadOthersAbsences
    ? AbsenceVisibility.OrganizationAbsences({ userId: reader.userId })
    : AbsenceVisibility.InvolvedAbsences({ userId: reader.userId, relatedUserIds: reader.relatedUserIds })
```

- HTTP builds one actor: commands take it, reads take `absenceVisibilityFromReader(actor)`.
- A system read passes `AbsenceVisibility.AllAbsences()`: explicit and greppable.
- A read-only principal (support "view as", another module) builds a reader. One that isn't a user (a feed token scoped to one assignee) gets its own variant (`AssigneeAbsences { assigneeId }`).
- The reader is `Pick<AbsenceActor, …>`; a separate type only when reads need different facts than writes.
- `Data.TaggedEnum`, not a schema: it is never decoded or encoded.
- Filter, never reject: an invisible absence is `AbsenceNotFoundError` (404, doesn't reveal it exists); a filter on an unrelated user returns `[]`.
