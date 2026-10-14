# Policies

## Where a rule lives

| Rule depends on | Example | Place |
|---|---|---|
| Organization membership | the actor is a member of the route's organization | `OrganizationMemberMiddleware` ([http.md](http.md)); not in the domain |
| A permission that changes a rule | may edit someone else's active absence | flag on the actor ([access.md](access.md)); a policy decides |
| Visibility | sees absences they're involved in; with `absences:read`, all | reader → `createAbsenceVisibilityForReader` ([access.md](access.md)) |
| State | archived can't be edited | the narrowing find; the input's `absence` type accepts only allowed states |
| The actor | the creator, or a permitted user on an active absence | first policy in the transition's list |
| Time or context | edit window; not archived while ongoing | a policy in the transition's list |
| A value invariant | `from < to` | the value constructor (`createPeriod`) |
| Data about the actor (I/O) | users the actor is related to | loaded once by the controller onto the actor (`relatedUserIds`) |
| Data about the target (I/O) | the assignee is an organization member | loaded by the use case into a required input field (`assigneeIsOrganizationMember`) |

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

- Per transition: a policy type over its input and an ordered list. The order decides which rejection is reported; the actor policy comes first.
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
- No `anyPolicy` / `allPolicies` combinators, no nested per-state policies, no wrapper around a flag that is already named.
