You fix review findings on PR {PR} for **{UNIT}**. Workspace: {DIR}, branch `{BRANCH}`. Contract: `{SPEC_DIR}/spec.md` and `story.md`. Project notes: {NOTES}.

Findings (Blocking and Should fix; Nits only where they are one-line):
{FINDINGS}

1. Read the repo `AGENTS.md`, the spec, and the files named in each finding.
2. Fix each finding. When the fix is "change the spec or the code", change the code to match the spec. If the code can't match it, stop and report.
3. For evidence findings, take the missing shots (`verify-ui` skill; run `ship up` in a sibling herdr pane) and publish them into the PR.
4. Run `pnpm check` and the tests for the touched Cases. Commit and push.

Final reply, at most 8 lines: each finding with fixed, or not and why, and the checks. Then stop.
