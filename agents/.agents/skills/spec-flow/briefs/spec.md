You write the spec for **{UNIT}** ({ISSUE}). Workspace: {DIR}, branch `{BRANCH}`. Another agent builds it once the person approves it, so the spec must stand on its own.

Read: the repo `AGENTS.md`; the `effect-ddd` skill (`SKILL.md`, `use-cases.md`, `spec.md`, plus `views.md` and `access.md` when the unit has reads); the project notes {NOTES}; the issue.
Legacy starting points: {LEGACY}

## Derive, don't port
1. Read the legacy area end to end: routes, UI actions, atoms, collections, endpoints, services, policies, subscribers, jobs and tests.
2. Derive the use cases, one line each: `actor → intent → outcome` plus the rules it checks. Name intents, not data changes. A read is a view.
3. Design the target from those use cases only. Legacy names, folder cuts and generic CRUD don't count as design input. Never port a service 1:1.
4. Bugs, dead endpoints and rules nobody enforces go under **Open**, each with options and a recommendation.

## Write
- `{SPEC_DIR}/story.md`: the story format from `use-cases.md`, `state: draft`.
- `{SPEC_DIR}/spec.md`: the `spec.md` format, plus the extra sections in the project notes.
- Keep it short: tables, code, call trees, `situation (rule n) → outcome` lines. Prose only for why, cost and rejected.

Commit both files on the branch. Ask nothing in chat; anything undecided goes under **Open**.

Final reply, at most 10 lines: the use cases, key decisions, the open points that matter, and the doc paths. Then stop. You do not build.
