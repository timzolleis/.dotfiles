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
- The constraints of a use case are its Cases: `situation → outcome` lines that become its rules and errors.

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
