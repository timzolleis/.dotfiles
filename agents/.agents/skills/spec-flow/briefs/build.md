You build **{UNIT}** ({ISSUE}) from its approved spec. Workspace: {DIR}, branch `{BRANCH}`.

The contract: `{SPEC_DIR}/story.md` and `{SPEC_DIR}/spec.md`, approved by the person. Build exactly that.

Read: the repo `AGENTS.md`; the `effect-ddd` skill and its reference for each part you build; the project notes {NOTES}; both docs. Read the legacy files the spec names, and others only when the spec leaves a fact open.

## Work
1. Follow the spec's module order: domain, use cases, views, infrastructure, HTTP, then the UI moved onto the new endpoints.
2. Write a test for every Case.
3. Delete everything the spec lists as replaced legacy code, in the same branch.
4. Don't review your own work beyond `pnpm check` and the tests: no `review` skill, no second pass over the diff. A review agent follows.
5. If the code forces a design change, write it into the spec and commit it, then say so in your final reply. Never open a Plannotator review yourself; the orchestrator takes the change to the person.

Commits are signed through 1Password. If `git commit` fails or hangs on signing, never bypass it: leave the changes staged, stop, and say so in your final reply.

## Done when
- `pnpm check` is green, and the tests for every Case pass.
- Shots cover the screens in the spec's `## UI`, nothing more (`verify-ui` commands; `ship up` in the background first; one `SHOT_SESSION={BRANCH}`). A `same` screen gets one `--label after --check` shot; open its PNG only when the check fails. A `changes` screen gets a before/after pair; read both. No state, size or mode variants unless `## UI` names them. 20 min for all shots together; a shot you can't take goes into the PR as "not captured" with the reason. `pnpm -s shot publish` once, after the PR is open.
- The story is set to `state: resolved` with the code paths filled in.
- The PR is open (`pr` skill) and links {ISSUE}.

Final reply, at most 10 lines: the PR URL, use cases shipped, legacy deleted (files, lines), checks, deviations from the spec, and the shot paths. Then stop.
