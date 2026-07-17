---
name: commit
description: Commit staged and unstaged changes with conventional commit messages.
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*)
model: claude-haiku-4-5
---

# Git Commit

## Important

Commit ALL pending changes in the working tree, not just files related to the current conversation. Ignore conversation context when determining what to commit.

## Step 1: Analyze

```bash
git status
git diff HEAD
git log --oneline -5
```

Review the FULL output. Every modified, added, and untracked file shown by `git status` must be considered for committing.

## Step 2: Group Changes

- Split into multiple commits if changes affect unrelated scopes
- Keep as one commit if all changes serve a single purpose
- Include ALL changes from `git status`, not just files discussed in this conversation

## Step 3: Commit Each Group

```bash
git add <specific-files>
git commit -m "<type>(<scope>): <description>"
```

## Conventional Commit Format

```
<type>(<scope>): <description>
```

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure, no behavior change |
| `test` | Add/update tests |
| `docs` | Documentation |
| `style` | Formatting only |
| `chore` | Build, deps, tooling |
| `perf` | Performance improvement |

**Scope:** Primary module/feature affected (e.g., `auth`, `api`, `user`, `repository`)

**Description:** Lowercase, imperative mood, no period, max 50 chars

## Constraints

- NO co-authorship footer
- NO emoji
- Stage specific files (avoid `git add -A`)
- Use imperative: "add" not "added" or "adds"
