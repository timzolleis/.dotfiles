# Use cases

A use case is one intent: who wants to do what, in the domain's words ("a member archives an absence whose period has ended"). The module is built around them; everything else serves one.

```text
use case     A member archives an absence whose period has ended.
service      ArchiveAbsenceService.archiveAbsence(ArchiveAbsenceRequest { organizationId, actor, absenceId })
command      ArchiveAbsenceCommand { actor }, from: [ActiveAbsence]
event        AbsenceArchivedEvent
entry points AbsenceController.archiveAbsence; a job, a listener
```

## Cutting use cases

- Name the intent, not the data change: `archiveAbsence`, not `updateAbsenceStatus`. A generic update hides which rules apply.
- A form that edits the entity's own content under one set of rules is one use case, `update<Type>` (`updateAbsenceReason`). Split it only when a field gets its own rule, permission, or consumer.
- Same intent, different permission: one use case; the difference is an actor flag (`mayEditOthersAbsences`).
- Different intents: separate use cases, even when they share states and rules (reschedule and reassign).
- Nothing deletes a row: removing is a command into a terminal state (withdraw), and a retention purge is a repository method, not a use case.
- A read is not a use case; it is a view ([views.md](views.md)).

## Service

One `Context.Service` per use case. Every one is the same five steps: the narrowing find, `Absence.decide` with the command built in place, `Absence.evolve`, the write with the state before and after, publish. A create has no find: `Absence.decide({ command, now })`, then `insertAbsence({ after: Absence.evolve({ event }) })`; every other use case calls `updateAbsence({ before, after })` ([repository.md](repository.md#port)). Publish after the write, so a failed write publishes nothing; the two are not atomic unless the host opts in ([repository.md](repository.md#atomic-events)). A use case holds no permission check: the decide's rule reads the actor's flag ([rules.md](rules.md)). Loads run in order; run them in parallel only after the narrowing find, and only when a span shows the time it saves.

```ts
// absence/application/archive-absence-service.ts
export type ArchiveAbsenceRequest = { readonly organizationId: OrganizationId; readonly actor: AbsenceActor; readonly absenceId: AbsenceId }

export class ArchiveAbsenceService extends Context.Service<ArchiveAbsenceService, {
  archiveAbsence(request: ArchiveAbsenceRequest): Effect.Effect<void,
    | AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError
    | NotAllowedToEditAbsenceError | AbsenceOngoingError
    | AbsenceChangedConcurrentlyError>
}>()("ArchiveAbsenceService") {
  static layerNoDeps = Layer.effect(ArchiveAbsenceService, Effect.gen(function* () {
    const absenceRepository = yield* AbsenceRepository
    const domainEvents = yield* DomainEvents
    return ArchiveAbsenceService.of({
      archiveAbsence: Effect.fn("ArchiveAbsenceService.archiveAbsence")(function* ({ organizationId, actor, absenceId }) {
        const now = yield* DateTime.now
        const absence = yield* absenceRepository.findActiveAbsenceById({ organizationId, absenceId })
        const event = yield* Effect.fromResult(Absence.decide({ absence, command: ArchiveAbsenceCommand.make({ actor }), now }))
        yield* absenceRepository.updateAbsence({ before: absence, after: Absence.evolve({ absence, event }) })
        yield* domainEvents.publishDomainEvent(event)
      }),
    })
  }))

  static layer = ArchiveAbsenceService.layerNoDeps.pipe(Layer.provide(PrismaAbsenceRepository.layer))
}
```

## Requests and commands

- "Command" is the domain command (`ArchiveAbsenceCommand`, [model.md](model.md#commands)). The use case's input is `ArchiveAbsenceRequest`: a plain readonly type in the service's file, the same for every entry point (controller, listener, job).
- The use case builds the command from the request and the facts it loaded; the request never enters the domain.
- The written signature lists the errors of the find, the decide, and the write. The decide's errors are inferred, so this is where a new rule's error shows.
- A use case returns `void` or the new id. Read shapes never enter the write side.

## Facts about the target

- The use case loads them and puts them on the command (`OrganizationMembers.isOrganizationMember` → `assigneeIsOrganizationMember`).
- The fact's shape is what it can be. A boolean when it has two outcomes that both mean something (`assigneeIsOrganizationMember`). A tagged union when one case makes the question moot (`AssigneeEligibility = OpenToEveryone | InAllowedTeam | OutsideAllowedTeams`: an absence open to everyone asks no team). An `Option` of the other record when a rule needs it (`overlappingAbsence: Option<ReportedAbsence>` → `AbsenceOverlapsError { absenceId }`; [rules.md](rules.md)).
- A fact loaded with branching I/O is a port in the domain, named after the fact (`AssigneeEligibilities.findAssigneeEligibility`), with an adapter in `infrastructure/`; never a `load…` helper in `application/`.
- Load every time, even when the actor wouldn't need it (`mayAssignAnyone`): skipping the call moves the rule into the use case.
- Load after the find, so a missing state is 404 before anything about the target.

```text
ReassignAbsenceService.reassignAbsence({ organizationId, actor, absenceId, assigneeId })
├─ AbsenceRepository.findEditableAbsenceById({ organizationId, absenceId })
│    : Effect<EditableAbsence, AbsenceNotFoundError | AbsenceAlreadyArchivedError>
├─ OrganizationMembers.isOrganizationMember({ organizationId, userId: assigneeId })
│    : Effect<boolean>   → assigneeIsOrganizationMember
├─ Absence.decide({ absence, command: ReassignAbsenceCommand.make({ actor, assigneeId, assigneeIsOrganizationMember }), now })
│    : Result<AbsenceReassignedEvent, NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | NotAllowedToAssignAbsenceError | AbsenceEditWindowClosedError>
│  └─ checkRules([onlyCreatorOrPermittedCanEditRule, …, editOnlyInFirstHourRule], { absence, actor: command.actor, …, now })
├─ Absence.evolve({ absence, event }): EditableAbsence
├─ AbsenceRepository.updateAbsence({ before, after })
│    : Effect<void, AbsenceChangedConcurrentlyError>
└─ DomainEvents.publishDomainEvent(event): Effect<void>
```
