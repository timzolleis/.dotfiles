---
name: commit
description: Commit all staged, unstaged, and untracked changes as one or more coherent conventional commits. Use when the user asks to commit the working tree.
---

# Commit Changes

1. Inspect the entire working tree with `git status --short`, `git diff HEAD`, and `git log --oneline -5`. Read untracked files too.
2. Group changes by purpose. Use one commit when they form one change; split unrelated work into separate commits.
3. Commit every pending change, including work unrelated to the conversation. Never discard or rewrite changes to make them fit a commit.
4. Stage each group with specific paths, then commit it.
5. Run `git status --short` afterward and report the commits created.

Use `<type>(<scope>): <description>` with `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`, or `perf`. Keep the description lowercase, imperative, under 50 characters, and without a period.

Do not use `git add -A`, emoji, or co-author footers.
