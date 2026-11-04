# Story

A **story** describes one area of the domain (a core type or a concept): its use cases and rules in the user's words, then its design as pseudocode. It is the current truth about the area: the code must keep it true, and when they disagree, fix the story first. A change to the area is a change to its story, drafted with the user one part at a time ([Designing with the user](SKILL.md#designing-with-the-user)) and built only once they agree; the story's diff in the PR is the plan.

Draft in this order, and show each part before the next: opening and terms, use cases, data, rules with their examples, UI, then the design, one section at a time.

## Shape

~~~md
---
name: absence
description: Members report absences for themselves or related users and archive them once the period has ended.
type: story
state: draft
---

# Absences

"A member reports an absence, and it counts in staffing until it has ended."

A member reports a period they are away, for themselves or, with permission, for anyone. An absence starts as a draft that only its creator sees, counts in staffing once activated, and is archived after it ends. Modeled on vacations: `vacation/application/`, `web/src/vacations/`.

## Terms

| Term | Meaning | In code |
|---|---|---|
| absence | a period a member is away, in whole days | `Absence` |
| assignee | the member who is away; not always the creator | `assigneeId` |
| staffing | who works on a given day; an active absence takes its assignee out | `StaffingView` |

## Use cases

- A member drafts an absence for themselves or a related user.
- The creator activates their draft.
- A member archives an absence whose period has ended.

Existing use cases this changes:

- **Staffing:** an active absence takes its assignee out of every day of its period (rule 4).

## Data

| Field | Type | Content |
|---|---|---|
| assignee | member | who is away |
| period | days, from–to, inclusive | Mon 12 Oct – Fri 16 Oct 2026 |
| reason | text, optional, max. 500 | "doctor's appointment" |

## Rules

1. **Related users only.** A member drafts for themselves or for a user related to them, because only a related user can confirm the period. Refused with "You can only report absences for yourself or people you look after."
2. **Creator, or with permission.** The creator edits and archives their own. A member allowed to edit others' absences (`absences.edit-any`) edits anyone's, including drafts they did not create.
3. **Only active absences are archived.** A draft never counted in staffing, so archiving it would hide that it was never activated; the creator activates or deletes it.
4. **Only once ended.** The last day must be over: an ongoing absence still counts in today's staffing, and archiving it would put the assignee back on today's plan. A period ending today can be archived from tomorrow.
5. **Archived stays in the history.** An archived absence leaves the member's list and the staffing, and stays in the history with its period and reason unchanged.

## Examples

| Alice's absence Mon 12 Oct – Fri 16 Oct 2026 | Result |
|---|---|
| Alice archives it on Sat 17 Oct | archived |
| Alice archives it on Fri 16 Oct | refused, still ongoing (rule 4) |
| Bob archives it on Sat 17 Oct, without `absences.edit-any` | refused (rule 2) |

**Archive before the end:** on Fri 16 Oct at 18:00 Alice opens her absence. "Archive" is disabled with "Ongoing until Fri 16 Oct". On Sat 17 Oct it is enabled; after archiving, the absence is gone from "My absences" and listed under "History".

## UI

- **Menu:** "Absences" after "Vacations", route `/me/absences`.
- **Header:** "Absences", below it "Alice · 2026 · 3 absences"; on the right the button "Report absence".
- **Table:** From, To, Days, Reason, actions "Edit" and "Archive"; sorted by From. Empty: "No absences in 2026".
- **Dialog:** From and To default to today; To follows when From moves past it. The rule's message shows live below the fields and disables "Save".
- **Loading and errors** as in views: "Loading…", on an error the message with "Retry".

## Deliberately different

- **Archive is not delete.** Vacations are deleted; absences are archived, because payroll reads past absences (rule 5).

## Open

- **Archive on a schedule?** A nightly job archives ended absences, or members archive them? Recommend members: a job needs a system actor.

## Design

Host mapping: tenant is the organization (`OrganizationMemberMiddleware`); permissions via `hasPermission`; `DomainEvents` is the host's outbox.

### Lifecycle

```text
  ┌───────┐ activate ┌────────┐ archive ┌──────────┐
  │ Draft │ ───────▶ │ Active │ ──────▶ │ Archived │
  └───────┘          └────────┘         └──────────┘
```

```ts
activateAbsence({ absence: DraftAbsence, actor, now }): Result<AbsenceActivatedEvent, NotAbsenceCreatorError>
archiveAbsence({ absence: ActiveAbsence, actor, now }):  Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
```

Cases
  archive a draft (rule 3)                               → AbsenceStillDraftError (findActiveAbsenceById)
  archive someone else's, mayEditOthersAbsences (rule 2) → AbsenceArchivedEvent
  archive while the period is ongoing (rule 4)           → AbsenceOngoingError

### Model (`domain/absence-id.ts`, `domain/absence.ts`)

```ts
AbsenceId = prefixedId("abs").pipe(Schema.brand("AbsenceId"))

const absenceFields = { absenceId: AbsenceId, organizationId: OrganizationId, creatorId: UserId, assigneeId: UserId, period: Period, createdAt: Schema.DateTimeUtc }
DraftAbsence  = Schema.TaggedStruct("DraftAbsence",  { ...absenceFields })
ActiveAbsence = Schema.TaggedStruct("ActiveAbsence", { ...absenceFields, activatedAt: Schema.DateTimeUtc })
```

`Draft`, not `Pending`: nobody approves it; the creator activates it.
Rejected: one `Absence` with a `status` field: archive would accept a draft at compile time.

### Events and errors (`domain/absence-event.ts`, `domain/absence-error.ts`)

```ts
AbsenceDraftedEvent         { creatorId, assigneeId, period }   // createAbsence; occurredOn becomes createdAt
AbsenceArchivedEvent        {}                                  // archiveAbsence

AbsenceNotFoundError        { absenceId }                       // every find, AbsenceViews.getAbsenceById
AbsenceStillDraftError      { absenceId }                       // findActiveAbsenceById
```

### Table                                            ← only when persistence changes

```prisma
model Absence { … }
```

### Modules

```text
AbsenceController                   absence endpoints
├─ ArchiveAbsenceService            archive one active absence
│  └─ AbsenceRepository             narrowed finds, event → write → publish
└─ AbsenceViews                     AbsenceView reads, filtered by visibility
```

Files (`+` new, `~` changed):

```diff
  absence/
  ├─ domain/
+ │  ├─ absence-id.ts               AbsenceId
+ │  ├─ absence.ts                  states, transitions
…
```

#### ArchiveAbsenceService.archiveAbsence (`application/archive-absence-service.ts`)
Owns: archiving one active absence.

```text
ArchiveAbsenceService.archiveAbsence({ organizationId, actor, absenceId })
├─ AbsenceRepository.findActiveAbsenceById({ organizationId, absenceId })
│    : Effect<ActiveAbsence, AbsenceNotFoundError | AbsenceStillDraftError | AbsenceAlreadyArchivedError>
├─ archiveAbsence({ absence, actor, now })
│    : Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
└─ AbsenceRepository.publishAbsenceEvent(event)
     : Effect<void, AbsenceChangedConcurrentlyError>
```

Cases (memory repository, TestClock)
  active absence, period ended (rule 4)  → AbsenceArchivedEvent written
  already archived (rule 3)              → AbsenceAlreadyArchivedError

Cost: an absence that ends tonight stays active until someone archives it.
Rejected: archive on read when the period has ended: a read would write.
~~~

## The parts

- **Frontmatter**: `description` is one sentence of who does what; it is the pointer an agent picks the story by. `state` is `draft` while a change to the story is drafted or built, `resolved` once the code matches it.
- **Opening**: the user's goal as one quoted sentence, in their words. Then a short paragraph: the kinds of things, who acts, how it moves. Name the existing code it is modeled on, if any, so the builder copies its shape instead of inventing one.
- **Terms**: each domain word the story uses, its meaning, and its name in code once there is one. One word per meaning: the code's names follow this table ([naming.md](naming.md)).
- **Use cases**: one sentence per intent, who wants to do what ([use-cases.md](use-cases.md#cutting-use-cases)). Then the existing use cases, in this story or another, whose behavior changes, each with the rule that changes it.
- **Data**: the fields in domain terms, each with its type in words and an example value. Not the table.
- **Rules**: numbered per story, never renumbered. A bold name, then prose: what holds, why, and what follows from it, including the consequences nobody would guess ("a period ending today can be archived from tomorrow"). The reason decides the edge cases nobody listed. Write the user-facing message word for word. When rules compete, state the precedence and why. Cite `rule 3` within the story, `absence rule 3` across stories. Only some become a code rule; place each with [rules.md](rules.md).
- **Examples**: a table of concrete values (dates, users, amounts), never placeholders; each refusal cites its rule. Then a short scenario for what a table can't show: what the user sees before and after. Cover the edges the rules imply: the boundary instant, a year change, a DST day. A test of that rule uses the example's values, with actors named by role ([testing.md](testing.md)).
- **UI**, when the story has one: where it lives, the exact copy, columns and order, the empty state, dialog defaults, what disables an action, loading and errors.
- **Deliberately different**: where the story departs from the existing code it is modeled on, or from what a reader would expect, with the reason and what came before. A reader who would "fix" it reads why not.
- **Open**: each undecided point with the options and a recommendation. Empty before the design.

## The design

The last section: the area's design as pseudocode, in the order a reader builds it. It holds decided design only, drafted after the parts above are agreed. A change shows its design as a diff on this section.

Code, call trees, and `situation → outcome` lines carry it. Prose says only what code can't: why a name, what a choice costs, what was rejected. Lists of events, errors, finds, writes, and endpoints are commented code lines, not tables.

- The first line maps the concept to the host: tenant, access, event publishing, Effect version. Conventions appear only where they differ from effect-ddd.
- The design cites rules as `(rule n)`, never restates them. A new or changed rule goes into Rules first.
- One `####` per module along the call path: `Owns:` in one line, then signatures, call tree, Cases. Leave out what the module doesn't have.
- Cases are the module's test list ([testing.md](testing.md)); name the fixture in the heading. Every rule has a Case. A Case that cites no rule is a decision the user never reviewed: add the rule or drop the Case.
- `Rejected:` only for an alternative that was weighed and a reader would propose again; `Cost:` only for a downside the design accepts. One line each, next to the decision.
- Every name greps to its definition. Ports owned by other modules are examples: name the method, not who implements it.
