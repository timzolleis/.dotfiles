---
name: pr
description: Create or update the pull request for the current branch with a consistent title and description. Use when the user asks to open, update, or write a PR.
---

# Pull Request

1. Review the whole branch, not just the last commit: `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD`.
2. If the work has a spec (`plans/*.md`), read it — the "why" and the approved decisions live there, reuse them.
3. Check for an existing PR with `gh pr view --json number,title,body`. If one exists, update it with `gh pr edit`; otherwise create it with `gh pr create`.
4. Draft the title and body, then create or update the PR and print its URL.

When the branch is `main`, create a feature branch named `<type>/<short-description>` and push it with `-u` before opening the PR. Never push to `main`, and never force-push without asking first.

Renaming a PR's head branch closes the PR. To rename, open a new PR from the new branch and comment `Superseded by <url>` on the old one.

## Title

Under 60 characters, imperative, no trailing period, no conventional-commit prefix — `Remove unused spass package`, not `fix: some changes`.

## The rule

**The reviewer can already see which files changed. Explain what they can't see: why, and what they have to accept.**

Write for someone who will read the diff after your description, and needs to know what to look for.

## Voice

Write like the user talks to a teammate: casual, direct, first person plural ("we", "us"). Proper capitalization and full sentences, but plain words — "Resend said no", "don't die anymore", "so batches actually fill up". When the user wrote the existing description, keep their wording and only fix capitalization and typos.

## Body

No headers. Short paragraphs in this order:

```markdown
<Problem: what hurts today, as a failure story. 1-2 short paragraphs.
"Before, we … This meant …">

<The change, in one paragraph: what the system does now and how, at the level
a reviewer needs before reading the diff.>

**Tradeoff:** <Only if the reviewer has to accept a new risk or lost guarantee.
What we lose, why, and the concrete failure it allows. Skip if none.>

Also in here:
- <Other behavior changes a reviewer would otherwise have to dig out of the
  diff. One or two sentences each. Skip anything the change paragraph already
  says. Skip the list if empty.>
```

A one-line fix gets the problem sentence and nothing else.

## Never

- Section headers, templates, or a per-file table of changes.
- Restating the diff ("added `category` to the interface, added it to the mapper, added it to the payload"). Say it once.
- A bullet that repeats the change paragraph.
- Test plans, generated-by footers, emoji — unless asked.
- Formal or corporate phrasing ("This PR introduces", "leverages", "ensures").

## Posting

Pass the body via a quoted HEREDOC so formatting and backticks survive:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```
