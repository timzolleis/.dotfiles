Use plain technical English, guided by ASD-STE100 and Google developer documentation style.

Lead with the point. Prefer bullets to prose. Use everyday words. Keep sentences short and active. Reuse the codebase's terms and flag conflicts. When it helps, show behavior as entry point → decision → dependency → result or failure. Name what fails and its effect.

## Decision priority

When rules conflict, this order wins:

1. Correctness, safety, and debuggability.
2. These global rules.
3. More specific repository instructions.
4. Compatible existing conventions.
5. Contain incompatible legacy patterns at the nearest boundary instead of spreading them.
6. Leave unrelated code alone unless a migration is requested.

## Tools and commands

Use `read` to inspect files, `edit` for precise changes, and `write` for new files or intentional full rewrites. Read the target before inserting or replacing content. Use shell commands for search, repository inspection, and project commands, not as a substitute for file tools.

Read-only exploration is always allowed. Run formatting, typechecking, and focused tests as needed. Do not start servers or watch modes, install packages, deploy, run migrations, or mutate systems outside the working tree unless the request explicitly requires it. Commit and push only when asked.

## Workflow

Choose the primary workflow from this map:

| Task | Start with |
|---|---|
| Ask or explore something | No workflow skill |
| Feature, changed behavior, interface, or meaningful refactor | `design-first` |
| Approved plan or one named todo | `implement` |
| Reproduce and fix a bug | `diagnosing-bugs` loads automatically |
| Explicit test-first work at an agreed seam | `tdd` |
| Review a diff | `code-review` |
| Stress-test a design | `grill-me` |
| Edit skills or agent instructions | `writing-for-agents` |
| Switch sessions with unfinished work | `handoff` |

Load skills progressively. Start with the one primary workflow above. Load a specialist skill only when the current step needs its detailed guidance. Do not preload every skill whose description loosely matches. Coding standards remain automatic for matching code changes, but load only the topic references needed for the current concern.

Plans live in `plans/<kebab-case-name>.md` and follow `$HOME/.agents/skills/design-first/PLAN-FORMAT.md`.

## Engineering rules

**Inspect before designing.** Read the nearest instructions and domain language. Trace one relevant operation through its decisions and effects. Find the most recent comparable implementation, but copy it only when it still follows the current rules.

**Reuse before adding.** Search for the concept before creating a type, model, error, service, helper, component, formatter, label map, fixture, or abstraction. Prefer reuse as-is, then extension, then a new owner only when reuse would couple unrelated concerns.

**Give each concern one owner.** Business meaning and invariants belong to the domain. Application policy and effect order belong to the application capability. Protocol, framework, persistence, and vendor mechanics belong to adapters. Construction belongs to the composition root. Split code when it has two independent reasons to change. Delete pass-through wrappers whose removal makes the system simpler.

**Keep boundaries explicit.** Parse untrusted input where it enters the system. Preserve validated domain values inside. Keep framework, database, and vendor representations behind their owners. Make expected failures explicit and translate them at the outer boundary. Do not hide a failure that a caller can act on.

**Preserve type evidence.** Reuse owning schemas and public types instead of redeclaring them. Model meaningful variants and lifecycle states so invalid combinations are hard to construct. Avoid casts, non-null assertions, broad records, and unbranded identifiers when stronger evidence exists. Use the repository's language and runtime conventions rather than imposing one library everywhere.

**Make effects safe.** Keep effect order visible when it changes behavior. Independent work may run concurrently when ordering is irrelevant. Retried mutations need an idempotency strategy. Do not hold a database transaction across a network call. Use controlled time, randomness, and identifiers when determinism matters.

**Use discoverable names.** Name code for what it is or does in the domain's existing words. Keep one definition site per symbol. Rename stale identifiers when behavior changes. Avoid vague buckets such as `utils` or `helpers` when a real concept owns the behavior.

**Comments must add information.** Do not require a comment for every export. Comment only when the code cannot express a non-obvious reason, invariant, precondition, unit, ownership rule, ordering constraint, or sharp edge. Delete narration, provenance notes, banners, obvious labels, and stale commented-out code.

**Test owned behavior.** Ask what this layer could still get wrong if every dependency behaved perfectly. Test that decision through the public interface, once, at the layer that owns it. Use a real dependency when its semantics are the behavior; otherwise use the narrowest faithful stub, fake, or recording fake. Do not test private structure or a dependency's documented contract.

**Keep scope controlled.** Change only files required by the task. Preserve unrelated work. Do not edit generated or lock files manually unless the repository explicitly requires it.

## Before completion

1. Inspect the full diff, staged changes, and untracked files. Confirm every file belongs to the task.
2. Search each new concept and exported name for an existing owner or duplicate definition.
3. Trace every changed caller-visible behavior through its decisions, effects, and failure path.
4. Check touched boundaries for validation, type loss, hidden expected failures, unsafe retries, transaction lifetime, and sensitive diagnostics.
5. Remove unnecessary wrappers, assertions, comments, and speculative abstractions.
6. Confirm each test exercises a decision owned by the named layer.
7. Run the repository's required checks and affected tests. Report what passed and what could not run.

Report format:

```text
Changed         - <file>: <one line>
Left on purpose - <file>: <what> — <why>
Needs decision  - <problem> — A / B
```

## Debugging and instruction feedback

Diagnose from evidence. State a falsifiable cause, run a focused check, then edit. After two failed fixes, stop and report what you observed, expected, tried, and learned, plus the next useful check or decision.

When the same mistake repeats, propose correcting the existing instruction that should prevent it. Add a new rule only when no current rule covers the behavior, and ask before changing instructions.
