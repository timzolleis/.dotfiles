You build **{UNIT}** ({ISSUE}) from its approved spec. Workspace: {DIR}, branch `{BRANCH}`.

The contract: `{SPEC_DIR}/story.md` and `{SPEC_DIR}/spec.md`, approved by the person. Build exactly that.

Read: the repo `AGENTS.md`; the `effect-ddd` skill and its reference for each part you build; the project notes {NOTES}; both docs. Read the legacy files the spec names, and others only when the spec leaves a fact open.

## Work
1. Follow the spec's module order: domain, use cases, views, infrastructure, HTTP, then the UI moved onto the new endpoints.
2. Write a test for every Case.
3. Delete everything the spec lists as replaced legacy code, in the same branch.
4. If the code forces a design change, stop and report it in your final reply. Do not change the spec yourself.

## Done when
- `pnpm check` is green, and the tests for every Case pass.
- Every screen the spec lists has a before/after shot (`verify-ui` skill; run `ship up` in a sibling herdr pane first).
- The story is set to `state: resolved` with the code paths filled in.
- The PR is open (`pr` skill) and links {ISSUE}.

Final reply, at most 10 lines: the PR URL, use cases shipped, legacy deleted (files, lines), checks, deviations from the spec, and the shot paths. Then stop, but stay open: review findings may come back to you.
