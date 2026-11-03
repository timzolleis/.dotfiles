# Change

A change is one PR's delta to a story: why, the design this skill can't derive, the Cases, and when it is done. The user approves it, with the story edits, before any code is written. Where it lives is the host's fact, usually the tracker issue; it is not a repo file the code must keep true.

Once the PR merges, the change is frozen. Nobody edits it, and nobody takes current names or paths from it: the story and the code hold what is true now.

## Shape

~~~md
---
name: absence-archive
description: A member archives an absence once its period has ended.
type: change
changes: absence
state: open
---

# Archive absences

"A member clears ended absences out of their list."

Today ended absences stay active and count in staffing forever.
Story: use case "A member archives an absence whose period has ended" and absence rules 3–5 are new; rule 5 changes "A member sees their absences".
Out of scope: a nightly archive job.

## Design

```ts
// absence/domain/absence.ts
ArchivedAbsence = Schema.TaggedStruct("ArchivedAbsence", { ...absenceFields, archivedAt: Schema.DateTimeUtc })
archiveAbsence({ absence: ActiveAbsence, actor, now }): Result<AbsenceArchivedEvent, NotAllowedToEditAbsenceError | AbsenceOngoingError>
archiveAbsenceRules = [onlyCreatorOrPermittedCanEditRule, cannotArchiveWhileOngoingRule]

// absence/domain/absence-event.ts, absence-error.ts
AbsenceArchivedEvent        {}
AbsenceOngoingError         { absenceId, endsOn }   // 409
AbsenceAlreadyArchivedError { absenceId }           // findActiveAbsenceById
```

`Archived`, not `Closed`: the story says archived, and it stays in the history (rule 5).
Rejected: archive on read once the period has ended: a read would write.
Cost: an absence that ends tonight stays active until someone archives it.

## Cases

```text
archive a draft (rule 3)                         → AbsenceStillDraftError (findActiveAbsenceById)
archive on Fri 16 Oct, period ongoing (rule 4)   → AbsenceOngoingError
archive on Sat 17 Oct (rule 4)                   → AbsenceArchivedEvent
someone else's, mayEditOthersAbsences (rule 2)   → AbsenceArchivedEvent
archived row changed meanwhile                   → AbsenceChangedConcurrentlyError (adapter, real database)
```

## Done when

- a test per Case that earns one ([testing.md](testing.md)); the host's checks are green
- the story describes the new behavior and is `state: resolved`
- legacy removed: `absence-status-endpoint.ts`, `useUpdateAbsenceStatus`
~~~

## Sections

- **Frontmatter**: `changes` names the story, or several. `state` is `open`, `later` or `resolved`; the PR that builds it sets `resolved`.
- **Intro**: the intent in one quoted sentence, then what is wrong today, then the story edits by use case and rule number. The story edits land in the same PR; the change never restates a rule. List each existing use case or view whose behavior changes, with the rule that changes it.
- **Design**: only what this skill doesn't decide. New or changed states, transition signatures and rule lists, events, errors with their status, facts and ports, and what each new find narrows to. Leave out unchanged types, the module tree, the file tree, and anything [use-cases.md](use-cases.md) already makes mechanical. Lists of events and errors are commented code lines, not tables. Name the file in a comment the first time.
- **Persistence**: only when a table or index changes; the schema lines that change.
- **Call tree**: only when a path isn't find → transition → publish: a loaded fact, a port, a job, a listener.
- **Cases**: one `situation (rule n) → outcome` line each, naming the error or event; concrete values from the story's examples. Every rule the change touches has a Case. A Case that cites no rule is a decision the user never reviewed: add the rule to the story or drop the Case. An infrastructure Case (concurrency, a guarded write) cites no rule and names its fixture.
- **Done when**: tests, checks, the story updated, legacy removed. Nothing the reviewer can't check.

## Writing it

- Code, call trees and Case lines carry it. Prose says only what code can't: why a name, what a choice costs, what was rejected.
- `Rejected:` only for an alternative that was weighed and a reader would propose again; `Cost:` only for a downside the design accepts. One line each, next to the decision.
- When a reason will still matter after the merge (why archived stays in the history), it goes into the story as one sentence at its rule. The plan stays here.
- Every name greps to its definition. Ports owned by other modules are examples: name the method, not who implements it.
- Open points go to the user with the change, each with options and a recommendation. A decided point becomes a rule, a Case or a `Rejected:` line.
- If the code forces a design change while building, edit the change and tell the user before the PR merges.
