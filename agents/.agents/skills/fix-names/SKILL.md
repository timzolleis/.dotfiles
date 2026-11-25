---
name: fix-names
description: "Find names that break the repo's naming rules and rename them. User-invoked: /fix-names <path>."
disable-model-invocation: true
argument-hint: "<path or glob; default: files changed on this branch>"
---

# Fix names

Find the names in scope that break the naming rules, agree the new names with the user, then rename them everywhere.

Scope: `$ARGUMENTS`. Without one, the files changed against the default branch.

## 1. Read the rules

Read, in this order:

- the naming rules in the repo's instruction files (`AGENTS.md`, `CLAUDE.md`)
- the repo's glossary, when it has one (`CONTEXT.md`, `GLOSSARY.md`)
- the Names section of the `code-style` skill

On conflict the repo wins. They are the only rules. Do not add your own taste.

## 2. Find

List every exported name in scope: functions, types, constants, union values. Judge each one against the rules.

A name is a finding only when it breaks a rule you can quote. A name that follows the rules stays, even if you would have picked another.

For each finding, propose the new name:

- Take the glossary's word when there is one.
- Grep the new name. A name the repo already uses is taken.
- When several names are one concept, propose one name for all of them and say they merge.

## 3. Ask

A public name is a design decision, so the user decides it. Show one table, at most 30 names, the worst first:

| Name | Where | Rule it breaks | New name |
|---|---|---|---|

Under it, list what you will not rename and why (step 5). Then wait. The user changes, drops or approves rows. Rename only approved rows.

## 4. Rename

Rename one name at a time, everywhere it appears:

- the declaration, every import and every call
- tests, including test names that quote it
- docs, stories and the glossary
- the file, when the file is named after it

A merge of several names into one is more than a rename: keep one definition, move the callers to it, delete the others.

After each batch of about ten names, run the repo's check command. At the end, run its check and its tests. Grep each old name: zero hits, or the reply says where it remains and why.

## 5. Never rename

These names are stored or sent, so a rename is a migration or a breaking change. List them under the table and leave them:

- database tables and columns
- a stored tag, state name, event name or error code
- a field of an API request or response, and a route path
- a name another deployed program or a stored file reads

## 6. Report

Bullets of eight words or fewer: names renamed, names merged, names skipped with the reason, and the check and test results. Do not commit unless asked.
