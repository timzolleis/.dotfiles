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

## Stories

A **story** describes one area of the domain (a core type or a concept) and all its use cases, for the person who knows the domain, in their words, before any type name. They review it; the code must keep it true. When story and code disagree, fix the story first.

~~~md
---
name: absence
description: Members report absences for themselves or related users and archive them once the period has ended.
type: story
state: draft
---

# Absences

"A member reports an absence, and it counts in staffing until it has ended."

An absence is drafted, activated, and archived. Members report their own; with permission, anyone's.

## Use cases

| Use case | Rules |
|---|---|
| A member drafts an absence for themselves or a related user. | 1, 2 |
| A member archives an absence whose period has ended. | 2–5 |

## Data

| Field | Type | Content |
|---|---|---|
| assignee | member | who is absent |
| period | days, from–to | Mon 12 Oct – Fri 16 Oct 2026 |

## Rules

1. **Related users only.** A member drafts for themselves or a user related to them.
2. **Creator, or with permission.** The creator edits their own; a member allowed to edit others' absences edits anyone's.
3. **Only active absences are archived.** A draft is activated first.
4. **Only once ended.** The period must have ended: an ongoing absence still counts in today's staffing.
5. **Archived stays in the history.** An archived absence leaves the member's absence list and stays in the history.

## Examples

| Alice's absence Mon 12 Oct – Fri 16 Oct 2026 | Result |
|---|---|
| Alice archives it on Sat 17 Oct | archived |
| Alice archives it on Fri 16 Oct | refused, still ongoing (rule 4) |
| Bob archives it on Sat 17 Oct, without permission | refused (rule 2) |

## Open

- **Archive on a schedule?** A nightly job archives ended absences, or members archive them? Recommend members: a job needs a system actor.
~~~

- **Frontmatter**: `description` is one sentence of who does what; it is the pointer an agent picks the story by. `state` is `draft` until built, then `resolved`.
- **Intent**: one quoted sentence, the user's goal in their words. Then a short intro: the kinds of things, who acts.
- **Use cases**: one row per intent ([Cutting use cases](#cutting-use-cases)), with the rules it checks.
- **Data**: the fields in domain terms, each with an example value. Not the table.
- **Rules**: the constraints, numbered per story. A bold name, then one sentence, then the reason when it isn't obvious; the reason decides the edge cases nobody listed. When rules compete, state the precedence and why. Cite `rule 3` within the story, `absence rule 3` across stories. Only some become a code rule; place each with [rules.md](rules.md).
- **Examples**: a table of concrete values (dates, users, amounts), never placeholders; each refusal cites its rule. Cover the edges the rules imply: the boundary instant, a year change, a DST day. A test of that rule uses the example's values ([testing.md](testing.md)).
- **Open**: each undecided point with the options and a recommendation. Empty before the spec.
- **Once built**, add: the code (paths to services, views, rules), a column on Use cases naming each entry point, **Interface** (endpoints or tools, with their errors), and **Tests** (which test covers which rules, and which rules have none).

The Cases map the rules to code, one `situation (rule n) → outcome` line each, naming the error or event:

```text
archive a draft (rule 3)                      → AbsenceStillDraftError (findActiveAbsenceById)
archive while the period is ongoing (rule 4)  → AbsenceOngoingError
```

Every rule has a Case. A Case that cites no rule is a decision the user never reviewed: add the rule to the story or drop the Case.

## Service

One `Context.Service` per use case. Every one is the same three steps: find the narrowed state, call its transition, publish the event. Loads run in order; run them in parallel only after the narrowing find, and only when a span shows the time it saves.

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
- The fact's shape is what it can be. A boolean when it has two outcomes that both mean something (`assigneeIsOrganizationMember`). A tagged union when one case makes the question moot (`AssigneeEligibility = OpenToEveryone | InAllowedTeam | OutsideAllowedTeams`: an absence open to everyone asks no team). An `Option` of the holder when the refusal names it (`overlappingAbsence: Option<ReportedAbsence>` → `AbsenceOverlapsError { absenceId }`).
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
└─ AbsenceRepository.publishAbsenceEvent(event)
     : Effect<void, AbsenceChangedConcurrentlyError>
```
