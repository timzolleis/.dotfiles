# Rules

A rule is one business constraint of a transition: a pure function over the transition's input that succeeds or fails with a typed error. Each transition runs an ordered list. Many constraints aren't rules; place a constraint before writing it.

Not a policy: an Event Storming policy ("whenever X, do Y") is an event subscriber, and a permission gate is forbidden ([access.md](access.md)).

## Where a constraint lives

Rows apply when the host has the concept ([access.md](access.md)).

| Constraint depends on | Example | Place |
|---|---|---|
| Tenant membership | the actor is a member of the route's organization | the host's tenant check at the edge (`OrganizationMemberMiddleware`, [http.md](http.md)); never the domain |
| A permission | may edit someone else's active absence | a flag on the actor, set by the permission adapter; a rule decides |
| Visibility | sees absences they're involved in; with a read permission, all | the visibility rule (`absenceVisibilityFromReader`); views filter by it |
| State | archived can't be edited | the narrowing find; the input's state type accepts only allowed states |
| Who acts | the creator, or a permitted user on an active absence | first rule in the transition's list |
| Time or context | edit window; not archived while ongoing | a rule in the transition's list |
| A value invariant | `from < to` | the value constructor (`createPeriod`) |
| Facts about the actor (I/O) | users the actor is related to | loaded once by whoever builds the actor, onto the actor (`relatedUserIds`) |
| Facts about the target (I/O) | the assignee belongs to the tenant | loaded by the use case into a required input field (`assigneeIsOrganizationMember`) |

## Rule lists

```ts
// lib/check-rules.ts
// The first rejection wins.
export const checkRules = <Input, E>(
  rules: ReadonlyArray<(input: Input) => Result.Result<void, E>>,
  input: Input,
): Result.Result<void, E> => {
  for (const rule of rules) {
    const ruleResult = rule(input)
    if (Result.isFailure(ruleResult)) return ruleResult
  }
  return Result.succeed(undefined)
}
…
export type ReassignAbsenceRule = (input: ReassignAbsenceInput) => Result.Result<
  void, NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | NotAllowedToAssignAbsenceError | AbsenceEditWindowClosedError
>
export const reassignAbsenceRules: ReadonlyArray<ReassignAbsenceRule> = [
  onlyCreatorOrPermittedCanEditRule, // may I touch this absence?
  assigneeMustBeInOrganizationRule,  // is the new assignee in the organization?
  assigneeMustBeSelfOrRelatedRule,   // may I give it to them?
  editOnlyInFirstHourRule,
]
// …one rule type and list per transition
```

- Per transition: a rule type over its input and an ordered list. The order decides which rejection is reported; the who-acts rule, if any, comes first. It also keeps the later rules from reporting on what the actor may not know about: another family's child is "not related", never "already signed up".
- One list per transition, even when two lists are identical today, so they can diverge without a rename.
- A shared rule takes a subset of the input (`{ actor; assigneeId }`), so it fits every list that names it.
- A new rule is one function added to one list, plus its error in the rule type and the transition's signature.

## One per … across records

A constraint across records ("one reported absence per person and day") is a rule over the loaded holder, not a boolean.

- The use case loads `Option<Holder>` (`findOverlappingAbsence`); the rule fails with an error that names the holder (`AbsenceOverlapsError { absenceId }`).
- The rule never compares the holder to the actor: the actor's own record refuses like anyone's.
- An edit that can change the key runs `mustChange…Rule` first, so the record never meets itself. Never pass the edited id so the find can skip it.
- The rule reports; it doesn't guarantee. Two writes at the same moment both pass. Default: a `Cost:` line in the spec. Guard in the database only when the race leaves wrong data that a reload or retry doesn't fix (a double booking, money, another organization's data); write that outcome in one sentence first. A gap in positions or a tie in sort order is not one.

## Writing a rule

```ts
// absence/domain/absence-rule.ts
const isActingUser = (input: { readonly actor: AbsenceActor; readonly userId: UserId }) => input.userId === input.actor.userId
const isAbsenceCreator = (input: { readonly absence: Absence; readonly actor: AbsenceActor }) =>
  isActingUser({ actor: input.actor, userId: input.absence.creatorId })
…
export const onlyCreatorOrPermittedCanEditRule = (input: { readonly absence: EditableAbsence; readonly actor: AbsenceActor }) => {
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
- When the rule differs per state, branch with `Match.valueTags`: it is exhaustive, so a new state doesn't compile until it has a rule.
- Combine with `||` / `&&` over named boolean predicates (`isAbsenceCreator`, `isRelatedToActor`).
