You fix review findings on PR {PR} for **{UNIT}**. Workspace: {DIR}, branch `{BRANCH}`. Contract: `{SPEC_DIR}/spec.md` and `story.md`. Project notes: {NOTES}.

Findings (Blocking and Should fix; Nits only where they are one-line):
{FINDINGS}

1. Read the repo `AGENTS.md`, the spec, and the files named in each finding.
2. Fix each finding. When the fix is "change the spec or the code", change the code to match the spec. If the code can't match it, stop and report.
3. Take shots only for an evidence finding in the list, with the build brief's rules: a `same` screen gets one `--check` after shot, a `changes` screen a pair; 10 min in total. Then `pnpm -s shot publish`.
4. Run `pnpm check` and the tests for the touched Cases. Commit and push.

Commits are signed through 1Password. If `git commit` fails or hangs on signing, never bypass it: leave the changes staged, stop, and say so in your final reply.

Final reply, at most 8 lines: each finding with fixed, or not and why, and the checks. Then stop.
