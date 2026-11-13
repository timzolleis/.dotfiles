# Rules

A rule is one business constraint of a command: a pure function over the input its `decide` hands it, returning `Result<void, E>`. Each decide runs its rules in order. Many constraints aren't rules; place a constraint before writing it.

The example names rules policies (`checkPolicies`, `…Policy`, `absence-policy.ts`); write `checkRules`, `…Rule`, `absence-rule.ts`.

Not a policy: an Event Storming policy ("whenever X, do Y") is an event subscriber, and a permission gate is forbidden ([access.md](access.md)).

## Where a constraint lives

Rows apply when the host has the concept ([access.md](access.md)).

| Constraint depends on | Example | Place |
|---|---|---|
| Tenant membership | the actor is a member of the route's organization | the host's tenant check at the edge (`OrganizationMemberMiddleware`, [http.md](http.md)); never the domain |
| A permission alone | may export; may manage data sources | a flag on the actor; a one-line rule in the decide reads it and fails with `NotAllowedTo…Error` (`onlyPermittedCanShareRule`). The use case holds no check, so the find runs first: a missing record answers not found before the permission is read |
| A permission with state or ownership | may edit someone else's active absence, or is its creator | a flag on the actor, set by the permission adapter; a rule decides |
| Visibility | sees absences they're involved in; with a read permission, all | the visibility rule (`absenceVisibilityFromReader`); views filter by it |
| State | archived can't be edited | the narrowing find; the record's `from` accepts only allowed states |
| Who acts | the creator, or a permitted user on an active absence | first rule in the decide's `checkRules` call |
| Time or context | edit window; not archived while ongoing | a rule in the decide's `checkRules` call |
| A value invariant | `from < to` | the value constructor (`createPeriod`) |
| Facts about the actor (I/O) | users the actor is related to | loaded once by whoever builds the actor, onto the actor (`relatedUserIds`) |
| Facts about the target (I/O) | the assignee belongs to the tenant | loaded by the use case into a required command field (`assigneeIsOrganizationMember`) |

## Running rules

```ts
// absence/domain/absence-policy.ts
type PolicyError<Policy> = Policy extends (input: never) => Result.Result<void, infer Error> ? Error : never

// The first rejection wins.
export const checkPolicies = <Input, const Policies extends ReadonlyArray<(input: NoInfer<Input>) => Result.Result<void, unknown>>>(
  policies: Policies,
  input: Input,
): Result.Result<void, PolicyError<Policies[number]>> => {
  for (const policy of policies) {
    const policyResult = policy(input)
    if (Result.isFailure(policyResult)) return policyResult as Result.Result<void, PolicyError<Policies[number]>>
  }
  return Result.succeed(undefined)
}
```

```ts
// absence/domain/absence.ts
        yield* checkPolicies(
          [onlyCreatorOrPermittedCanEditPolicy, assigneeMustBeInOrganizationPolicy, assigneeMustBeSelfOrRelatedPolicy, editOnlyInFirstHourPolicy],
          { absence, actor: command.actor, assigneeId: command.assigneeId, assigneeIsOrganizationMember: command.assigneeIsOrganizationMember, now },
        )
```

- `checkRules` lives in `lib/check-rules.ts`. Its error is the union of the rules' errors, inferred; a rule that doesn't fit the input fails to compile on that rule. It is called inline in the decide, with the input written out from the state, the command, and `now`. No rule types, no named lists: the order sits at the call. The order decides which rejection is reported; the who-acts rule, if any, comes first. It also keeps the later rules from reporting on what the actor may not know about: another family's child is "not related", never "already signed up".
- A decide with one rule calls it: `yield* onlyPermittedCanArchiveRule({ absence, actor: command.actor })`. `checkRules` arrives with the second rule, which is when order starts to matter.
- Each rule takes only what it reads (`{ absence: ActiveAbsence; now }`), so it fits every decide that calls it, and its type claims only its own error.
- A new rule is one function and one entry in each decide that runs it.

## One per … across records

A constraint across records ("one reported absence per person and day", "one reason per name") is a rule over the other record, loaded onto the command, not a boolean.

- The repository finds it in the query: `find<Type>By<Key>` returns `Option<…>` (`findOverlappingAbsence`, `findAbsenceReasonByName`), and the value keeps its name into the rule (`reasonWithSameName`). Load the whole list only when the decide needs it anyway (positions); the rule still takes the one record.
- One rule serves create and edit. It passes when the found record has the id of the record that gets the key: a create retried with the same id reaches the write (`AbsenceChangedConcurrentlyError`: the id is taken), and an edit that keeps its key, or changes only its case, meets itself.
- The rule never compares the found record to the actor: the actor's own record refuses like anyone's.
- The error names the other record (`AbsenceOverlapsError { absenceId }`) only when a client acts on it; otherwise it carries the value (`AbsenceReasonNameTakenError { name }`).
- "Same value" is the value's `Equivalence` ([model.md](model.md)), which the form uses too; the find's query must agree with it.
- With a unique index, the write maps the violation straight to the error; no lookup to fill its fields.
- The rule reports; it doesn't guarantee. Two writes at the same moment both pass. Default: a `Cost:` line in the story's decisions. Guard in the database only when the race leaves wrong data that a reload or retry doesn't fix (a double booking, money, another organization's data); write that outcome in one sentence first. A gap in positions or a tie in sort order is not one.

## Writing a rule

```ts
// absence/domain/absence-policy.ts
const isActingUser = (input: { readonly actor: AbsenceActor; readonly userId: UserId }) => input.userId === input.actor.userId
const isAbsenceCreator = (input: { readonly absence: EditableAbsence; readonly actor: AbsenceActor }) =>
  isActingUser({ actor: input.actor, userId: input.absence.creatorId })
…
export const onlyCreatorOrPermittedCanEditPolicy = (input: { readonly absence: EditableAbsence; readonly actor: AbsenceActor }) => {
  const notAllowedToEditAbsence = () => Result.fail(new NotAllowedToEditAbsenceError({
    absenceId: input.absence.absenceId, actorId: input.actor.userId, absenceState: input.absence._tag,
  }))
  return Match.valueTags(input.absence, {
    DraftAbsence: () => isAbsenceCreator(input) ? Result.succeed(undefined) : notAllowedToEditAbsence(),
    ActiveAbsence: () => isAbsenceCreator(input) || input.actor.mayEditOthersAbsences ? Result.succeed(undefined) : notAllowedToEditAbsence(),
  })
}
```

- Named as in [naming.md](naming.md): `onlyCreatorCanActivateRule`, `cannotArchiveWhileOngoingRule`, `editOnlyInFirstHourRule`.
- Type a rule by the states it reads (`EditableAbsence`), never by `Absence`: that union is derived from the aggregate, and the aggregate imports the rule, so the type is circular.
- When the rule differs per state, branch with `Match.valueTags`: it is exhaustive, so a new state doesn't compile until it has a rule.
- Combine with `||` / `&&` over named boolean predicates (`isAbsenceCreator`, `isRelatedToActor`).
