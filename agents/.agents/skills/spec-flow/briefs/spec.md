You write the change for **{UNIT}** ({ISSUE}) and the story edits it implies. Workspace: {DIR}, branch `{BRANCH}`. Another agent builds it once the person approves it, so the change must stand on its own.

Read: the repo `AGENTS.md`; the `effect-ddd` skill (`SKILL.md`, `use-cases.md`, `change.md`, plus `views.md` and `access.md` when the unit has reads); the project notes {NOTES}; the issue.
Legacy starting points: {LEGACY}

## Derive, don't port
1. Read the legacy area end to end: routes, UI actions, atoms, collections, endpoints, services, policies, subscribers, jobs and tests.
2. Derive the use cases, one line each: `actor → intent → outcome` plus the rules it checks. Name intents, not data changes. A read is a view.
3. Design the target from those use cases only. Legacy names, folder cuts and generic CRUD don't count as design input. Never port a service 1:1.
4. Bugs, dead endpoints and rules nobody enforces go under **Open**, each with options and a recommendation.

## Write
- `{STORY}`: the story format from `use-cases.md`. Edit it when it exists; create it with `state: open` when not. It says what holds after this PR, with no history.
- `{CHANGE}`: the `change.md` format, plus the extra sections in the project notes. It is outside the repo; don't commit it.
- Keep the change short: code, Case lines, one-line `Rejected:` and `Cost:`. Leave out what `effect-ddd` already decides.

Commit the story on the branch. Ask nothing in chat; anything undecided goes under **Open**.

Final reply, at most 10 lines: the use cases, key decisions, the open points that matter, and both paths. Then stop. You do not build.
