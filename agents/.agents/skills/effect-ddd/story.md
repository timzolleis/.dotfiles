# Story

A **story** describes one area of the domain (a core type or a concept): its use cases and rules in the user's words, its lifecycle, and the decisions behind it. It is the current truth about the area and the only document about it; it lives where the host's `AGENTS.md` says. A change to the area is a change to its story, written once the user and the agent have explored it ([Designing with the user](SKILL.md#designing-with-the-user)), and built only once they agree.

The user verifies a rule in one scroll: the rule, then its rows in the examples. A builder's brief names the use cases of its slice and the rules they run. Short beats complete: 60 to 120 lines. One or two examples per rule, the typical case and the refusal, plus the boundary when a value decides it. More rows hide the rule they illustrate.

Signatures, call trees, file trees, endpoint tables and per-file plans are not part of the story. A slice's design goes to plan review and then into the PR body ([Designing with the user](SKILL.md#designing-with-the-user)); once built it is the code, and a copy in the story only goes stale.

## Shape

~~~md
# Absences

"A member reports an absence, and it counts in staffing until it has ended."

A member reports a period they are away, for themselves or, with permission, for anyone. An absence starts as a draft that only its creator sees, counts in staffing once activated, and is archived after it ends. Modeled on vacations (`vacation/application/`).

## Terms

| Term | Meaning | In code |
|---|---|---|
| assignee | the member who is away; not always the creator | `assigneeId` |
| staffing | who works on a given day; an active absence takes its assignee out | `StaffingView` |

## Use cases

- A member drafts an absence for themselves or a related user (rule 1). `DraftAbsenceService`
- The creator activates their draft (rule 2). `ActivateAbsenceService`
- A member archives an absence whose period has ended (rules 2, 3, 4). `ArchiveAbsenceService`

Changes elsewhere: **Staffing** takes an active absence's assignee out of every day of its period (rule 5).

## Rules

1. **Related users only.** A member drafts for themselves or for a user related to them. Why: only a related user can confirm the period. Message: "You can only report absences for yourself or people you look after."
2. **Creator or permitted.** The creator acts on their own absence; with permission to edit others' absences, anyone does. Message: "Only the creator can change this absence."
3. **Active only.** Only an active absence is archived; a draft is deleted instead.
4. **Only once ended.** The last day must be over. Why: an ongoing absence still counts in today's staffing; archiving it would put the assignee back on today's plan. A period ending today can be archived from tomorrow. Message: "Ongoing until Fri 16 Oct."
5. **Out of staffing.** An active absence removes its assignee from every day of its period; a draft or archived one changes nothing.

## Examples

An active absence running Mon 12 – Fri 16 Oct 2026. The member is related to its assignee; the stranger is not.

| Situation | Result |
|---|---|
| Member drafts for a related user | drafted |
| Member drafts for the stranger | refused (rule 1) |
| Member archives on Sat 17 Oct 00:00 | archived (rule 4) |
| Member archives on Fri 16 Oct 23:59 | refused, ongoing (rule 4) |

## UI

- **Menu:** "Absences" after "Vacations", route `/me/absences`.
- **Table:** From, To, Days, Reason, actions "Edit" and "Archive"; sorted by From. Empty: "No absences in 2026".
- **Archive** is disabled while ongoing, with the message of rule 4.

## Lifecycle

```text
  ┌───────┐ activate ┌────────┐ archive ┌──────────┐
  │ Draft │ ───────▶ │ Active │ ──────▶ │ Archived │
  └───────┘          └────────┘         └──────────┘
```

A draft is visible to its creator only; active since `activatedAt`; archived keeps its period for payroll.

## Decisions

- **Archive, not delete.** Vacations are deleted; payroll reads past absences (rule 5).
- **`Draft`, not `Pending`.** Nobody approves it; the creator activates it.
- **Archive is a member action, not a nightly job.** A job needs a system actor. Cost: an absence that ends tonight stays active until someone archives it.
- **Not included:** half days, archiving on a schedule.

## Open

- **Reason required?** Recommend optional: most schools don't use reasons.
~~~

## The parts

- **Opening**: the user's goal as one quoted sentence, in their words. Then a short paragraph: the kinds of things, who acts, how it moves. Name the existing code it is modeled on, so the builder copies its shape instead of inventing one.
- **Terms**: only the words a reader could misread, each with its meaning and its name in code. The code's names follow this table ([naming.md](naming.md)).
- **Use cases**: one line per intent, who wants to do what ([use-cases.md](use-cases.md#cutting-use-cases)), the rules it runs, and its service once built. Then `Changes elsewhere`: existing use cases whose behavior changes, each with the rule.
- **Rules**: numbered per story, never renumbered. Each: a bold short name, what holds, `Why:`, and the consequences nobody would guess. The reason decides the edge cases nobody listed. The user-facing message word for word. Two to four lines a rule; a rule that needs more is two rules. Cite `rule 3` within the story, `absence rule 3` across stories. Only some rules become a code rule; place each with [rules.md](rules.md).
- **Examples**: one table of situations with roles or named people, never one table per rule; a concrete value only where it decides the case; a sentence above names the fixture. Each row is a test ([testing.md](testing.md)): a row without a test is a decision the code never checked; a test without a row is a decision the user never saw.
- **UI**, when the story has one: where it lives, the exact copy, columns and order, the empty state, what disables an action and which rule.
- **Lifecycle**, when there is more than one state: the diagram, then one line per state saying what it guarantees. The states' names are the code's ([naming.md](naming.md)).
- **Decisions**: everything a reader would otherwise "fix" or propose again: a name, a split, a departure from the modeled-on code, what is left out, a downside accepted (`Cost:`), an alternative turned down (`Rejected:`). One or two lines each; cite rules as `(rule n)`, never restate them.
- **Open**: only undecided points, each with the options and a recommendation. Once the user decides, the point moves into a rule or a decision and leaves `Open`.

## The PR

A PR is one slice: the use cases agreed for it ([Delivery](SKILL.md#delivery)). Its body is the story's diff when there is one, the example rows it makes true, and the call tree when the path isn't the plain find → decide → evolve → save → publish; a PR with no story diff names the rule it serves. It is done when every example row of its rules has a test and the host's checks pass.
