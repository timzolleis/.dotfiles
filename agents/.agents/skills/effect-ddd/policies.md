# Policies

A policy is one rule of a transition: a pure function over the transition's input that succeeds or fails with a typed error. Each transition runs an ordered list. Many rules aren't policies; place a rule before writing it.

## Where a rule lives

Rows apply when the host has the concept ([access.md](access.md)).

| Rule depends on | Example | Place |
|---|---|---|
| Tenant membership | the actor is a member of the route's organization | the host's tenant check at the edge (`OrganizationMemberMiddleware`, [http.md](http.md)); never the domain |
| A permission | may edit someone else's active absence | a flag on the actor, set by the permission adapter; a policy decides |
| Visibility | sees absences they're involved in; with a read permission, all | the visibility rule (`absenceVisibilityFromReader`); views filter by it |
| State | archived can't be edited | the narrowing find; the input's state type accepts only allowed states |
| Who acts | the creator, or a permitted user on an active absence | first policy in the transition's list |
| Time or context | edit window; not archived while ongoing | a policy in the transition's list |
| A value invariant | `from < to` | the value constructor (`createPeriod`) |
| Facts about the actor (I/O) | users the actor is related to | loaded once by whoever builds the actor, onto the actor (`relatedUserIds`) |
| Facts about the target (I/O) | the assignee belongs to the tenant | loaded by the use case into a required input field (`assigneeIsOrganizationMember`) |

## Policy lists

```ts
checkPolicies(policies, input) → Result<void, union of the list's errors>   // runs in order, first rejection wins

type ReassignAbsencePolicy = (input: ReassignAbsenceInput)
  => Result<void, NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | NotAllowedToAssignAbsenceError | AbsenceEditWindowClosedError>
reassignAbsencePolicies: ReadonlyArray<ReassignAbsencePolicy> = [
  onlyCreatorOrPermittedCanEditPolicy,      // may I touch this absence?
  assigneeMustBeInOrganizationPolicy,       // is the new assignee in the organization?
  assigneeMustBeSelfOrRelatedPolicy,        // may I give it to them?
  editOnlyInFirstHourPolicy,
]
```

- Per transition: a policy type over its input and an ordered list. The order decides which rejection is reported; the who-acts policy, if any, comes first.
- One list per transition, even when two lists are identical today, so they can diverge without a rename.
- A shared policy takes a subset of the input (`{ actor; assigneeId }`), so it fits every list that names it.
- A new rule is one function added to one list, plus its error in the policy type and the transition's signature.

## Writing a policy

```ts
isActingUser     = (input: { actor: AbsenceActor; userId: UserId }) => input.userId === input.actor.userId
isAbsenceCreator = (input: { absence: Absence; actor: AbsenceActor }) =>
  isActingUser({ actor: input.actor, userId: input.absence.creatorId })

onlyCreatorOrPermittedCanEditPolicy = (input: { absence: EditableAbsence; actor: AbsenceActor }) =>
  Match.valueTags(input.absence, {
    DraftAbsence:  () => isAbsenceCreator(input)                                     ? succeed() : fail(NotAllowedToEditAbsenceError),
    ActiveAbsence: () => isAbsenceCreator(input) || input.actor.mayEditOthersAbsences ? succeed() : fail(NotAllowedToEditAbsenceError),
  })
```

- Name: the rule as a short sentence + `Policy`, without the subject (the file names it): `onlyCreatorCanActivatePolicy`, `cannotArchiveWhileOngoingPolicy`, `editOnlyInFirstHourPolicy`. "Permitted" means the actor holds the flag.
- When the rule differs per state, branch with `Match.valueTags`: it is exhaustive, so a new state doesn't compile until it has a rule.
- Combine with `||` / `&&` over named boolean predicates (`isAbsenceCreator`, `isRelatedToActor`).
