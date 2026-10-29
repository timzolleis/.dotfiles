You review PR {PR} for **{UNIT}**. Workspace: {DIR}, branch `{BRANCH}`.

Follow the `review` skill (`~/.agents/skills/review/SKILL.md`) on the PR, with these additions:
- **Spec drift:** check the code against `{SPEC_DIR}/spec.md` and `story.md`. Each use case, rule, Case, event and endpoint is there, and nothing exists that the spec doesn't name.
- **Legacy:** every file the spec lists as replaced is deleted. No caller still uses it, and no unmarked edge into legacy code remains.
- **Evidence:** `pnpm check` is green, tests exist for every Case, and the PR's published shots cover each `## UI` screen with no check findings (a pair for `changes`, one after shot for `same`, or "not captured" with a reason). Take no shots. Open a PNG only for a `changes` screen, or to confirm a problem the code shows. A missing shot for a `changes` screen is Should fix; any other evidence gap is a Nit.
- **Project notes** {NOTES}: check its constraints.

Edit nothing. Final reply: findings grouped as **Blocking**, **Should fix**, **Nit**, one line each: `file:line`, the problem, the rule it breaks, the fix. If there are none, say "clean". Then stop.
