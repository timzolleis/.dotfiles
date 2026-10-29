You write the guided review of PR {PR} for **{UNIT}**. Workspace: {DIR}, branch `{BRANCH}`. You write two files; the orchestrator sends them.

1. In {DIR}: `git fetch origin main`, then `git diff $(git merge-base origin/main HEAD) > {PATCH_OUT}`. The tree must be clean and pushed; if not, stop and say so.
2. Read `/tmp/spec-flow/guide-brief.json`: `methodology`, `output_schema`, `rules`. Follow them. Your sources are the patch, `git log --oneline origin/main..HEAD` and `gh pr view {PR}`. Read no other files.
3. Write the guide to {GUIDE_OUT}, matching `output_schema`, plus `"review": { "gitRef": "origin/main...HEAD", "base": "origin/main" }`.
4. Check coverage: every `diff --git` path in {PATCH_OUT} appears exactly once, in one section's `diffs` or in `unplacedFiles`. Fix the guide until it does.

Final reply, at most 3 lines: both paths, section count, and anything left out. Then stop.
