# Story

A **story** describes one area of the domain (a core type or a concept): its use cases and rules in the user's words, its lifecycle, and the decisions behind it. It is the current truth about the area and the only document about it: the code must keep it true, and when they disagree, fix the story first. A change to the area is a change to its story, drafted with the user one part at a time ([Designing with the user](SKILL.md#designing-with-the-user)) and built only once they agree. The story's diff in the PR is the plan; a PR that changes no story names the rule it serves. There are no change files, plans, or specs beside it: git has the history, the PR has the slice.

A story is read three ways, and its shape serves all three: the user verifies a rule in one scroll (the rule, then its rows in the examples table); a builder's brief names one use case row and the rules it runs; a checker greps it (every rule has a use case, an example, a test name that carries its number, and symbols that resolve). Short beats complete: a story is 60 to 120 lines. Two or three examples per rule, the typical case, the refusal, and the boundary when there is one. More rows hide the rule they illustrate.

Draft in this order, and show each part before the next: opening and terms, use cases, data, rules, examples, UI, then lifecycle and decisions. Signatures and call trees belong to the drafting conversation and the PR, not to the story: once built they are the code, and the story's symbols grep to it.

## Shape

~~~md
---
name: absence
description: Members report absences for themselves or related users and archive them once the period has ended.
type: story
epics: staffing
state: open
---

# Absences

"A member reports an absence, and it counts in staffing until it has ended."

A member reports a period they are away, for themselves or, with permission, for anyone. An absence starts as a draft that only its creator sees, counts in staffing once activated, and is archived after it ends. Modeled on vacations: [`vacation/application/`](../../src/vacation/application/).

## Terms

| Term | Meaning | In code |
|---|---|---|
| assignee | the member who is away; not always the creator | `assigneeId` |
| staffing | who works on a given day; an active absence takes its assignee out | `StaffingView` |

## Use cases

| Use case | Rules | Code |
|---|---|---|
| A member drafts an absence for themselves or a related user. | 1 | `DraftAbsenceService` |
| The creator activates their draft. | 2 | `ActivateAbsenceService` |
| A member archives an absence whose period has ended. | 2, 3, 4 | `ArchiveAbsenceService` |

Changes elsewhere: **Staffing** takes an active absence's assignee out of every day of its period (rule 5).

## Data

| Field | Type | Content |
|---|---|---|
| assignee | member | who is away |
| period | days, from–to, inclusive | Mon 12 Oct – Fri 16 Oct 2026 |
| reason | text, optional, max. 500 | "doctor's appointment" |

## Rules

1. **Related users only** (`assigneeMustBeSelfOrRelatedRule`, `AbsenceActor.relatedUserIds`). A member drafts for themselves or for a user related to them: only a related user can confirm the period. Message: "You can only report absences for yourself or people you look after."
2. **Creator or permitted** (`mayEditAbsenceRule`). The creator acts on their own absence; with `mayEditOthersAbsences`, anyone does. Message: "Only the creator can change this absence."
3. **Active only** (`findActiveAbsenceById`). Only an active absence is archived; a draft is deleted instead.
4. **Only once ended** (`cannotArchiveWhileOngoingRule`, `isPeriodOngoingAt`). The last day must be over: an ongoing absence still counts in today's staffing, and archiving it would put the assignee back on today's plan. A period ending today can be archived from tomorrow. Message: "Ongoing until Fri 16 Oct."
5. **Out of staffing** (`StaffingView`). An active absence removes its assignee from every day of its period; a draft or archived one changes nothing.

## Examples

Alice is related to Ben, not to Carla. Alice's absence runs Mon 12 – Fri 16 Oct 2026.

| Situation | Result | Test |
|---|---|---|
| Alice drafts for Ben | draft | `draft for a related user (rule 1) → AbsenceDraftedEvent` |
| Alice drafts for Carla | refused | `draft for an unrelated user (rule 1) → NotRelatedToAssigneeError` |
| Alice archives on Sat 17 Oct 00:00 | archived | `archive after the last day (rule 4) → AbsenceArchivedEvent` |
| Alice archives on Fri 16 Oct 23:59 | refused, ongoing | `archive on the last day (rule 4) → AbsenceOngoingError` |

## UI

- **Menu:** "Absences" after "Vacations", route `/me/absences`.
- **Table:** From, To, Days, Reason, actions "Edit" and "Archive"; sorted by From. Empty: "No absences in 2026".
- **Archive** is disabled while ongoing, with the message of rule 4.

## Not included

Half days, absences for unrelated users, archiving on a schedule.

## Deliberately different

- **Archive is not delete.** Vacations are deleted; absences are archived, because payroll reads past absences (rule 5).

## Open

- **Archive on a schedule?** A nightly job archives ended absences, or members archive them? Recommend members: a job needs a system actor.

## Lifecycle

```text
  ┌───────┐ activate ┌────────┐ archive ┌──────────┐
  │ Draft │ ───────▶ │ Active │ ──────▶ │ Archived │
  └───────┘          └────────┘         └──────────┘
```

A draft is visible to its creator only; active since `activatedAt`; archived keeps its period for payroll.

## Decisions

| Decision | Why | Code |
|---|---|---|
| `Draft`, not `Pending` | nobody approves it; the creator activates it | `DraftAbsence` |
| One schema per state, no `status` field | archive would accept a draft at compile time | `absence.ts` |
| Archive is a member action, not a job | a job needs a system actor (Open) | `ArchiveAbsenceService` |

Cost: an absence that ends tonight stays active until someone archives it.
Rejected: archive on read when the period has ended: a read would write.
~~~

## The parts

- **Frontmatter**: `description` is one sentence of who does what; it is the pointer an agent picks the story by. `epics` names the larger goals it serves, for finding stories, never a folder. `state` is `open` until the code matches every use case row, then `resolved`; a later change to the story sets it back to `open` in the PR that makes it, and the PR that catches the code up sets it to `resolved`.
- **Opening**: the user's goal as one quoted sentence, in their words. Then a short paragraph: the kinds of things, who acts, how it moves. Name the existing code it is modeled on, so the builder copies its shape instead of inventing one.
- **Terms**: only the words a reader could misread, each with its meaning and its name in code. The code's names follow this table ([naming.md](naming.md)).
- **Use cases**: one row per intent, who wants to do what ([use-cases.md](use-cases.md#cutting-use-cases)), the rules it runs, and its code: the use case service, filled in by the PR that builds it. A row is one PR ([Delivery](SKILL.md#delivery)); a row without code is unbuilt. Then `Changes elsewhere`: existing use cases whose behavior changes, each with the rule.
- **Data**: the fields in domain terms, each with its type in words and an example value. Not the table.
- **Rules**: a numbered list, numbered per story and never renumbered. Each: a bold short name, the code symbols that carry it in parentheses (rule function, actor flag, find, view: filled in by the PR that builds it), then what holds, why, and what follows from it, including the consequences nobody would guess ("a period ending today can be archived from tomorrow"). The reason decides the edge cases nobody listed. The user-facing message word for word. Two to four lines a rule; a rule that needs more is two rules. Cite `rule 3` within the story, `absence rule 3` across stories. Only some rules become a code rule; place each with [rules.md](rules.md).
- **Examples**: one table of concrete values (dates, users, amounts), never placeholders; a sentence above it names the fixture. Grouped by fixture when there are several, never one table per rule. Each row names its **test**, `situation (rule n) → outcome`, which is the test's name in code ([testing.md](testing.md)); the test uses the row's values. A row without a test is a decision the user never checked; a test without a row is a decision the user never saw.
- **UI**, when the story has one: where it lives, the exact copy, columns and order, the empty state, dialog defaults, what disables an action and which rule.
- **Not included**: what a reader would expect and the story leaves out, one line.
- **Deliberately different**: where the story departs from the code it is modeled on, or from what a reader would expect, with the reason. A reader who would "fix" it reads why not.
- **Open**: each undecided point with the options and a recommendation. Empty before the lifecycle is drawn.
- **Lifecycle**, when there is more than one state: the state diagram, then one line per state saying what it guarantees. The states' names are the code's ([naming.md](naming.md)). No field lists, no signatures: `Data` has the fields, the code has the types.
- **Decisions**: a table of decision, why, code, for what a reader would otherwise "fix": a name, a split, a non-obvious path (a second load, a policy, a cross-module port). A decision cites rules as `(rule n)`, never restates them; a new or changed rule goes into Rules first. `Rejected:` only for an alternative a reader would propose again; `Cost:` only for a downside the story accepts. One line each.

What the story does not hold: signatures, ports, call trees, per-file tables, host mapping. The layers are mechanical ([Layout](SKILL.md#layout)), the exhaustive matches catch a missing one, the host's `AGENTS.md` maps the concept to the host once, and a call tree is how a path is discussed ([Call trees](SKILL.md#call-trees)), in the chat or the PR, before it is code. Every symbol in the story greps to its definition.

## The PR

A PR is one use case row or one view. Its body is the story's diff when it has one, the example rows it makes true, and the call tree when the path isn't the plain find → decide → evolve → save; a PR with no story diff names the rule it serves. It is done when: every example row of its rules has its test, named as the row; the row's `Code` and the rules' symbols are filled in; `state` is right; the host's checks pass. Nothing else is written down.

## Checking a story

The host runs a check over its stories (`pnpm stories check` or the like) that fails when: a rule number appears in no use case row; a rule number appears in no example row's test name; an example row's test name has no test; a symbol in a rule's parentheses or a use case's `Code` cell doesn't resolve; a story is `resolved` while a use case row has no code. The check is what makes the story the truth instead of a wish.
