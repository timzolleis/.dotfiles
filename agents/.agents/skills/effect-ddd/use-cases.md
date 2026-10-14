# Use cases

One `Context.Service` per command. Every command is the same three steps: find the narrowed state, call its transition, publish the event.

```ts
// application/archive-absence-service.ts
type ArchiveAbsenceCommand = { readonly organizationId: OrganizationId; readonly actor: AbsenceActor; readonly absenceId: AbsenceId }

class ArchiveAbsenceService extends Context.Service<ArchiveAbsenceService, {
  archiveAbsence(command: ArchiveAbsenceCommand): Effect<void,
    | AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError   // find
    | NotAllowedToEditAbsenceError | AbsenceOngoingError                             // transition
    | AbsenceChangedConcurrentlyError>                                               // publish
}>()("ArchiveAbsenceService") {
  static layer = Layer.effect(ArchiveAbsenceService, Effect.gen(function* () {
    const absenceRepository = yield* AbsenceRepository
    return ArchiveAbsenceService.of({
      archiveAbsence: Effect.fn("ArchiveAbsenceService.archiveAbsence")(function* ({ organizationId, actor, absenceId }) {
        const now = yield* DateTime.now
        const absence = yield* absenceRepository.findActiveAbsenceById({ organizationId, absenceId })
        const event = yield* archiveAbsence({ absence, actor, now })            // domain function
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
├─ AbsenceRepository.findEditableAbsenceById({ organizationId, absenceId })   → AbsenceNotFoundError | AbsenceAlreadyArchivedError
├─ OrganizationMembers.isOrganizationMember({ organizationId, userId: assigneeId })   → assigneeIsOrganizationMember
├─ reassignAbsence({ absence, actor, assigneeId, assigneeIsOrganizationMember, now })
│  └─ checkPolicies(reassignAbsencePolicies)                                   → NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | …
└─ AbsenceRepository.publishAbsenceEvent(AbsenceReassignedEvent)               → AbsenceChangedConcurrentlyError
```

## Ports

- A port is a `Context.Service` with object arguments: `UserRelationships.listRelatedUserIds({ organizationId, userId })`, `OrganizationMembers.isOrganizationMember({ organizationId, userId })`, `DomainEvents.publishDomainEvent(event)`.
- A port owned by another module is an example in the spec: name the method, not who implements it.

## Wiring

- No layer that bundles every use case: each entry point provides the services it uses, so its requirements show which ones.
- A listener or job provides only its service's layer.
- The `Effect.fn` span records the domain error with full context before the HTTP edge maps it.
