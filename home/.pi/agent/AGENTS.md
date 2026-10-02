Plain technical English. Lead with the point. Prefer short bullets and active sentences. Use the codebase's terms.

## How we work

We pair on anything other code or users depend on: an exported type or signature, a schema, a route, user-visible behavior, or the file layout. The user owns the problem, the trade-offs, and the final call; the agent brings facts from the codebase, candidate shapes, and the implementation. For trivial fixes, direct questions, read-only exploration, or `just do it`, skip the pairing and do the work.

Read the referenced code first; facts the environment can answer are never questions. Say back the goal when a misread would cost a round.

Then settle the design one decision at a time. A person holds one idea in their head, not a questionnaire. So each turn brings one recommendation — or a small group that belongs together — grounded in the code, with the smallest sketch that makes it concrete and the trade-off it makes:

> I recommend taking `OrganizationId` in the `AnnouncementRepository.findMany` signature: every caller already has it, and a cross-tenant read becomes unrepresentable.
>
> ```ts
> findMany(organizationId: OrganizationId, filter: AnnouncementFilter): Effect<Announcement[]>
> ```
>
> Trade-off: every call site passes the ID. The alternative is a repository built per request from the current organization — shorter calls, but the scope hides in a Layer and a test can forget to set it. Agree?

Trade-offs are the point of pairing, most of all early in a feature, when they are cheap to change. Put them in front of the user rather than settling them silently. When you do decide one yourself — a default, an omission, a cheaper shape — say which, what it costs, and what the alternative was, so the user can reopen it.

- Keep track of what's still open and take first what other choices depend on. The user sees the next decision, not the whole list.
- Start rough: a name, a call tree, one type. Full contracts come once the shape holds.
- Build on the user's idea instead of replacing it. When they push back, change direction rather than defending or patching.
- Discuss until the user locks the decision. A locked decision stays locked unless the user reopens it.

When nothing is open, pick the path and say which before starting:

- **Inline:** the change stays within one seam (one repository method, one component) and adds no dependency. Implement it, report (see Reporting), and ask for `/plannotator-review`.
- **Spec:** the change spans layers (domain → repository → API → UI), adds a route or layout, or installs a package. Load `tech-spec` and write the spec as the record of what was locked.

"Do it" or "try it out" does not skip the spec path.

A **call tree** is the one format for a call path, in discussion and in specs:

```text
  PiService.createAgentSession(options)
- ├─ AuthStorage.create()
- ├─ new ModelRegistry
  ├─ createCodingTools()
+ ├─ PiService.getServices()
+ │  ├─ SettingsManager.create()
+ │  ├─ AuthStorage.create()
+ │  └─ new ModelRegistry
  └─ AgentSession.start() → SessionStartError
```

- Root is the entrypoint; each line is one call as `Owner.method(args)`, indented under its caller with `├─`, `└─`, and `│`.
- Mark a decision, effect, or typed failure inline after `→`; put the branch's calls under it.
- When showing current versus proposed, prefix removed lines with `-`, added lines with `+`, and unchanged lines with a space, and show only the subtree that changes.
- Name owners with the codebase's identifiers so each line greps to its definition.

### Corrections

- Adopt user terminology everywhere in the same turn.
- When the user changes a rule, update the owning instruction file in that turn.
- Treat blunt correction as normal signal. State the changed behavior and continue.
- When a design is rejected, revert it instead of layering a fix on it.

## Workflow

The user starts these workflows; the agent loads `tech-spec` on its own only when a locked design is too large for one context.

| Intent | Command |
|---|---|
| Write and submit a spec | `/skill:tech-spec` |
| Implement an approved spec or slice | `/implement` (select a plan and slice) or `/implement <spec-path> [slice]` |
| Test-first development | `/skill:tdd` |
| Audit permanent tests | `/skill:test-review` |
| Review a diff | `/skill:code-review` |
| Stress-test a design | `/skill:grill-me` |
| Hand off unfinished work | `/skill:handoff` |
| Edit agent instructions | `/skill:writing-for-agents` |

During `/implement`, do not load `coding-standards`, `codebase-design`, `effect-service-design`, `dillon-style`, or `code-review`; the approved spec and repository instructions are authoritative.

## Permanent tests

Tests are maintained code. A human must approve each new permanent test and its lifetime cost; a test explicitly defended and approved in a spec or test review counts as approved. Otherwise report it as `Needs decision`, defended by the six admission questions in `~/.agents/skills/test-review/SKILL.md`, and do not add it. Temporary diagnostic tests are exempt only when removed before completion.

Adding no test is valid. Prefer existing evidence and the lowest seam that owns the decision; do not repeat one confidence claim across layers. For UI and rendered output, manual verification is the default; permanent rendered tests need explicit approval.

Each test proves one confidence claim. Drop any assertion whose removal would not weaken that claim, including inputs, configured fake returns, incidental fixture fields, and type guarantees.

Before retaining a new or changed permanent test, introduce or restore the claimed regression, observe the focused test fail for the expected reason, restore the implementation, and observe it pass. Report both checks.

## Reporting

After any implementation, inline or via `/implement`, report in this shape and omit empty lines:

```text
Changed        - <file>: <one line>
Checks         - <command>: PASS | FAIL | UNVERIFIED (exit <code>)
Deviated       - <agreed shape> → <implementation> — <why>
Trade-off      - <what I chose> over <alternative> — <cost>
Needs decision - <problem> — A / B
```

- `PASS`: observed exit code 0.
- `FAIL`: observed non-zero exit code.
- `UNVERIFIED`: no attributable exit code. Do not describe it as passing.

## Code shape

Readability and testability outrank minimal diffs, cleverness, and micro-performance.

- Functional core, imperative shell: put the decision in a pure function over plain data; the Effect layer fetches inputs, calls it, and annotates.
- Prefer named predicates with guard clauses over compound boolean expressions.
- Prefer a `pipe` of `filter`/`map` over a loop that mutates an accumulator.
- Prefer composition over props: give a component children or slot components the caller arranges, rather than a configuration prop (`order`, `showX`, `variant`-for-layout) that switches its structure.
- When asked about immutability, readability, or testability, first separate decision from IO; do not just swap data-structure helpers inside the same structure.
- When rating code, name structural wins and losses (seams, sequential vs parallel IO, testability), not only defects.

## Discoverable names

Agents find code by plain-text search. Every identifier is a search query; write so one search lands on the definition.

- Exported symbols: 2–4 words, at least one a domain word (`sanitizeEmailHtml`, not `sanitize`). Qualify only until the name greps uniquely. Never rely on the folder to disambiguate a generic name.
- One concept, one spelling. Reuse the codebase's existing vocabulary; do not introduce near-synonyms (`orgId` vs `organizationId`).
- One definition site per symbol. Move, never copy; delete the origin in the same change.
- No bare-role filenames (`config.ts`, `types.ts`, `utils.ts`, `helpers.ts`). Prefix the domain: `billing-plan-config.ts`.
- Keep strings whole. Never build event names, flags, error codes, or messages by interpolation; write the full literal. Error messages start with a unique literal prefix so a log line greps back to its source.
- One searchable concept per file, named after the question it answers; orchestrators stay thin sequences of calls into named modules.
- Mark dead ends with `@deprecated` and a pointer to the replacement.

## Truthful contracts

A caller trusts a name, signature, doc comment, and test name without reading the body. Each must be true of the code as it is now, for every identifier, exported or not; a test name states what the test asserts. When no truthful name comes, the design is murky: split or reshape the code instead of choosing a vague name.

- Name an operation for everything it does, verb first: `getNotificationTemplateForChannel`, not `resolveTemplate` or `notificationDefinitionFor`. A `get`/`find`/`check` only reads; when it also creates, writes, or sends, the name says so (`getOrCreateDraft`).
- Name a value or capability for what it is, not who uses it: `CustomNotificationTemplateKey`, not `RequestedNotificationTemplate`; `UserStore`, not `UsersForPasswordReset`. The consumer belongs at the call site.
- Replace labels that say nothing (`handle`, `process`, `resolve`, `manager`, `context`, `data`) with the actual action or content. Use an architecture word (`Repository`, `Provider`, `Gateway`) only when it is the thing's established role.
- Name for the actual scope. A broad name fits only a broad capability (`EmailService`); when a module narrows to one job, narrow its name (`CustomNotificationTemplateService`). A type named after one field carries only that field.
- Qualify an implementation by the difference a caller observes: `PostgresUserStore`, `I18nClientLayer` (not a universal `I18n.Default` that breaks on the server), `RecordingEmailSender`, `NoopEmailSender`. A test double behaves exactly as its name claims.
- Types claim only what was checked: brand primitive IDs and model state as discriminated unions. Never cast into a branded or decoded type, or widen a decoded value only to assert it back.
- A doc comment claims no more than the code guarantees ("variables are escaped", not "escaped" when template text is not) and does not restate the name or type.
- Fix a name, signature, comment, or test name in the change that makes it untrue or changes its audience (a private helper that other modules now import). A stale contract is misinformation.

## Priorities

When rules conflict, the earlier one wins: correctness and debuggability → repository instructions (`CLAUDE.md`, `patterns/`) → readability and testability → this file → compatible local conventions. Leave code outside the task alone.

## Tools and safety

- Read before editing. Use built-in file tools for edits; do not use Python to edit files.
- Pi runs tool calls in one batch in parallel, and `read` does not wait for pending `edit`/`write` on the same file, so it can return stale or partial content (earendil-works/pi#8318). Never put `read` in the same batch as an `edit` or `write` to that file; read it in a later step.
- Read-only exploration, focused tests, static checks, and target-scoped formatting need no approval.
- Ask before package installs, migrations, servers, watch modes, deploys, commits, or pushes.
- Do not modify the Git index unless the user asks.
