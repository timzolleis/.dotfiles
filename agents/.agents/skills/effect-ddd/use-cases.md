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
- A form that edits the entity's own content under one set of rules is one use case, `update<Type>` (`updateAbsenceReason`). Split it only when a field gets its own rule, permission, or consumer.
- Same intent, different permission: one use case; the difference is an actor flag (`mayEditOthersAbsences`).
- Different intents: separate use cases, even when they share states and rules (reschedule and reassign).
- A read is not a use case; it is a view ([views.md](views.md)).

## Stories

The use cases of one area, with its rules, examples, lifecycle, and decisions, live in its story ([story.md](story.md)).

## Service

One `Context.Service` per use case. Every one is the same four steps: find the narrowed state, call its transition, `evolve` the event onto the state, save. The last line is the same in every use case; a create has no find and passes `before: Option.none()`. A use case whose flag decides alone gates first: `if (!actor.mayManageAbsences) return yield* new NotAllowedToManageAbsencesError({ actorId: actor.userId })` before the find ([access.md](access.md)). Loads run in order; run them in parallel only after the narrowing find, and only when a span shows the time it saves.

```ts
// absence/application/archive-absence-service.ts
export type ArchiveAbsenceCommand = { readonly organizationId: OrganizationId; readonly actor: AbsenceActor; readonly absenceId: AbsenceId }

export class ArchiveAbsenceService extends Context.Service<ArchiveAbsenceService, {
  archiveAbsence(command: ArchiveAbsenceCommand): Effect.Effect<void,
    | AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError
    | NotAllowedToEditAbsenceError | AbsenceOngoingError
    | AbsenceChangedConcurrentlyError>
}>()("ArchiveAbsenceService") {
  static layerNoDeps = Layer.effect(ArchiveAbsenceService, Effect.gen(function* () {
    const absenceRepository = yield* AbsenceRepository
    return ArchiveAbsenceService.of({
      archiveAbsence: Effect.fn("ArchiveAbsenceService.archiveAbsence")(function* ({ organizationId, actor, absenceId }) {
        const now = yield* DateTime.now
        const absence = yield* absenceRepository.findActiveAbsenceById({ organizationId, absenceId })
        const event = yield* Effect.fromResult(archiveAbsence({ absence, actor, now }))
        const before = Option.some(absence)
        yield* absenceRepository.saveAbsence({ event, before, after: evolveAbsence({ absence: before, event }) })
      }),
    })
  }))

  static layer = ArchiveAbsenceService.layerNoDeps.pipe(Layer.provide(PrismaAbsenceRepository.layer))
}
```

## Commands

- A plain readonly type in the service's file. Use a `Schema.Struct` only when the command crosses a process boundary (queue, persisted job, audit log).
- The same command serves every entry point: controller, listener, job.
- Never passed into the domain: the use case builds the transition input from the command, the loaded state, and `now`.
- A use case returns `void` or the new id. Read shapes never enter the write side.

## Facts about the target

- The use case loads them and puts them on the input (`OrganizationMembers.isOrganizationMember` → `assigneeIsOrganizationMember`).
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
├─ reassignAbsence({ absence, actor, assigneeId, assigneeIsOrganizationMember, now })
│    : Result<AbsenceReassignedEvent, NotAllowedToEditAbsenceError | AssigneeNotInOrganizationError | NotAllowedToAssignAbsenceError | AbsenceEditWindowClosedError>
│  └─ checkRules(reassignAbsenceRules, input)
├─ evolveAbsence({ absence: before, event }): Option<Absence>
└─ AbsenceRepository.saveAbsence({ event, before, after })
     : Effect<void, AbsenceChangedConcurrentlyError>
```
