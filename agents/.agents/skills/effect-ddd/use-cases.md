# Use cases

A use case is one intent: who wants to do what, in the domain's words ("a member archives an absence whose period has ended"). The module is built around them; everything else serves one.

```text
use case     A member archives an absence whose period has ended.
command      ArchiveAbsenceCommand { organizationId, actor, absenceId }
service      ArchiveAbsenceService.archiveAbsence
transition   archiveAbsence({ absence: ActiveAbsence, actor, now }) + archiveAbsenceRules
event        AbsenceArchivedEvent
entry points AbsenceController.archiveAbsence; a job, a listener
```

## Cutting use cases

- Name the intent, not the data change: `archiveAbsence`, not `updateAbsenceStatus`. A generic update hides which rules apply.
- Same intent, different permission: one use case; the difference is an actor flag (`mayEditOthersAbsences`).
- Different intents: separate use cases, even when they share states and rules (reschedule and reassign).
- A read is not a use case; it is a view ([views.md](views.md)).

## Describing a use case

Write it for the person who knows the domain, in their words, before any type name: they review it, and the code must keep it true.

```text
A member archives an absence whose period has ended.

1. Only an active absence can be archived; a draft is activated first.
2. The creator archives their own; a member allowed to edit others' absences archives anyone's.
3. The period must have ended: an ongoing absence still counts in today's staffing.

Examples (Alice's absence Mon 12 Oct – Fri 16 Oct 2026)
  Alice archives it on Sat 17 Oct                      → archived
  Alice archives it on Fri 16 Oct                      → refused, still ongoing (3)
  Bob archives it on Sat 17 Oct, without permission    → refused (2)
```

- **Intent**: one sentence, who wants to do what.
- **Constraints**: numbered, so Cases, tests, and other use cases cite them as `(n)`. Give the reason when it isn't obvious; the reason decides the edge cases nobody listed. When constraints compete, state the precedence and why. Place each one with [rules.md](rules.md).
- **Examples**: concrete values (dates, users, amounts), never placeholders. Cover the edges the constraints imply: the boundary instant, a year change, a DST day. A test of that constraint uses the example's values ([testing.md](testing.md)).

The Cases map the constraints to code, one `situation (n) → outcome` line each, naming the error or event:

```text
archive a draft (1)                      → AbsenceStillDraftError (findActiveAbsenceById)
archive while the period is ongoing (3)  → AbsenceOngoingError
```

Every constraint has a Case. A Case that cites no constraint is a decision the user never reviewed: add the constraint or drop the Case.

## Service

One `Context.Service` per use case. Every one is the same three steps: find the narrowed state, call its transition, publish the event.

```ts
// absence/application/archive-absence-service.ts
export type ArchiveAbsenceCommand = { readonly organizationId: OrganizationId; readonly actor: AbsenceActor; readonly absenceId: AbsenceId }

export class ArchiveAbsenceService extends Context.Service<ArchiveAbsenceService, {
  archiveAbsence(command: ArchiveAbsenceCommand): Effect.Effect<void,
    | AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError
    | NotAllowedToEditAbsenceError | AbsenceOngoingError
    | AbsenceChangedConcurrentlyError>
}>()("ArchiveAbsenceService") {
  static layer = Layer.effect(ArchiveAbsenceService, Effect.gen(function* () {
    const absenceRepository = yield* AbsenceRepository
    return ArchiveAbsenceService.of({
      archiveAbsence: Effect.fn("ArchiveAbsenceService.archiveAbsence")(function* ({ organizationId, actor, absenceId }) {
        const now = yield* DateTime.now
        const absence = yield* absenceRepository.findActiveAbsenceById({ organizationId, absenceId })
        const event = yield* Effect.fromResult(archiveAbsence({ absence, actor, now }))
        yield* absenceRepository.publishAbsenceEvent(event)
      }),
    })
  }))
}
```

## Commands

- A plain readonly type in the service's file. Use a `Schema.Struct` only when the command crosses a process boundary (queue, persisted job, audit log).
- The same command serves every entry point: controller, listener, job.
- Never passed into the domain: the use case builds the transition input from the command, the loaded state, and `now`.
- A use case returns `void` or the new id. Read shapes never enter the write side.

## Facts about the target

- The use case loads them and puts them on the input (`OrganizationMembers.isOrganizationMember` → `assigneeIsOrganizationMember`).
- Load every time, even when the actor wouldn't need it (`mayAssignAnyone`): skipping the call moves the rule into the use case.
- Load after the find, so a missing state is 404 before anything about the target.

```text
ReassignAbsenceService.reassignAbsence({ organizationId, actor, absenceId, assigneeId })
├─ AbsenceRepository.findEditableAbsenceById({ organizationId, absenceId })
│    : Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
├─ OrganizationMembers.isOrganizationMember({ organizationId, userId: assigneeId })
│    : Effect<boolean>   → assigneeIsOrganizationMember
├─ reassignAbsence({ absence, actor, assigneeId, assigneeIsOrganizationMember, now })
│    : Result<AbsenceReassignedEvent, NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | NotAllowedToAssignAbsenceError | AbsenceEditWindowClosedError>
│  └─ checkRules(reassignAbsenceRules, input)
└─ AbsenceRepository.publishAbsenceEvent(event)
     : Effect<void, AbsenceChangedConcurrentlyError>
```
