## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms.

## Pairing
Our primary workflow is paring on problems. This means an exported type or signature, a schema, a route, user-visible behavior, or the file layout. In our workflow, we first assess what is there (for refactors / reuse), build a shared context of that, and then go over to *discussing* solutions.
We want to discuss tradeoffs and ideas, until we lock it in. I own the final calls and the problems, you search facts from the code, bring candidate pseudocode / shapes and the implementation.
Exception: If something is a trivial fix, a direct question or an exploration, you may ask to skip pairing.

Read the referenced code first; a fact the environment can answer is never a question. Also before starting, restate the goal.

Then settle the design one decision at a time, or a small group that belongs together. Each turn brings a recommendation grounded in the code, the smallest sketch that makes it concrete, and the trade-off it makes:

> I recommend taking `AuthorizedOrganizationId` in `AnnouncementRepository.listAnnouncements`: every handler already gets it from the policy, and an unauthorized read stops compiling.
> Trade-off: system jobs need the explicit `trustAuthorizedOrganizationId`. The alternative is a `CurrentOrganization` in `R` — shorter calls, but the scope hides in context. Agree?

- Take first the decision other decisions depend on. The user sees the next decision, not the whole list.
- Start rough: a name, a call tree, one type. Full contracts come once the shape holds.
- Build on the user's idea. When the user pushes back, change direction instead of defending; revert a rejected design instead of layering a fix on it.
- A locked decision stays locked unless the user reopens it. When a later decision breaks one, say so.
- When you decide something yourself (a default, an omission, a cheaper shape), say what you chose, what it costs, and the alternative.
- Adopt the user's terms in the same turn. When the user changes a rule, update the file that owns it in that turn.

## Workflow

Designing a feature, integration, or refactor: load `codebase-design`. The spec grows with each locked decision, goes to Plannotator when complete, and is iterated there; then `/implement` each slice and review it with `/plannotator-review`. The spec is deleted after the build.

| Intent | Command |
|---|---|
| Design a change | `/skill:codebase-design` |
| Stress-test a design | `/skill:grill` |
| Implement an approved spec or slice | `/implement` or `/implement <spec-path> [slice]` |
| Test-first development | `/skill:tdd` |
| Review a diff | `/skill:code-review` |
| Audit permanent tests | `/skill:test-review` |
| Find deepening opportunities | `/skill:architecture-review` |
| Diagnose a failure | `/skill:diagnosing-bugs` |
| Hand off unfinished work | `/skill:handoff` |
| Edit agent instructions | `/skill:writing-for-agents` |

## Call trees

A **call tree** is the one format for a call path, in discussion and in specs:

```text
  AnnouncementService.publishAnnouncement(args)
  ├─ AnnouncementRepository.findAnnouncementById(organizationId, announcementId) → AnnouncementNotFoundError
- ├─ AnnouncementRepository.updateAnnouncement(changes)
+ ├─ AnnouncementRepository.publishAnnouncement(draft, by) → AnnouncementNotDraftError
  └─ EventClient.publish(AnnouncementPublishedEvent)
```

- The root is the entry point; each line is one call as `Owner.method(args)`, indented under its caller with `├─`, `└─`, and `│`.
- Mark a decision, effect, or typed failure inline after `→`; put the branch's calls under it.
- When showing current versus proposed, prefix removed lines with `-`, added lines with `+`, unchanged lines with a space, and show only the subtree that changes.
- Name owners with the codebase's identifiers so each line greps to its definition.

## Reporting

After any implementation, report in this shape and omit empty lines:

```text
Deviated       - <agreed shape> → <implementation> — <why>
Trade-off      - <what I chose> over <alternative> — <cost>
Needs decision - <problem> — A / B
```

## Safety

- Read before editing. Edit with the built-in file tools, never with scripts.
- Pi runs a batch of tool calls in parallel, and `read` does not wait for a pending `edit` or `write` to the same file. Never read a file in the same batch that edits it.
- Read-only exploration, focused tests, static checks, and target-scoped formatting need no approval.
- Ask before package installs, migrations, servers, watch modes, deploys, commits, or pushes. Never modify the Git index unless asked.

## References

- Writing, reviewing, or designing Effect code: load `effect-architecture`.
- A repository's `AGENTS.md` adds facts; `effect-architecture` wins unless the repository states an explicit exception.
- Correctness and debuggability outrank everything else here. Leave code outside the task alone.
