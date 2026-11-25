## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms. This applies to stories too: short sentences, and prose only for a rule's reason and consequences.
After changes, test. reply = ≤8-word bullets (✓ tested x, ⚠ bug a.js. If you have questions, ask last: a decision as one question with your pick (a design decision: as options, their pick first, per the `pairing` skill), and keep working on what does not wait on the answer.

## Naming
Name each thing for what it is, so a reader knows its kind from the name.
- No single letters or abbreviations, generics included: `<ValueSchema>`, not `<S>`.
- A name ends in its kind when the kind isn't obvious: `trimTransformation`, `checkedRowsFilter`, `DocumentExtractionService`. Suffixes like `Service`, `Factory`, `Repository` are fine.
- Names that differ in one word name different things. Rename one when two are too close to tell apart (`fieldValueTypes` beside `itemFieldValues`).

## Tool use
- Edit files with the `edit` tool: one call per file, all of that file's changes in it. A script (python, sed, a codemod) only for one mechanical change across many files.
- Screenshots (T3 preview) only when UI work needs visual verification, and then once at the end, to find and fix issues. Normal implementation work takes none.
- Open every PR with the `pr` skill, and write or update every PR body with it. A brief that tells a subagent to open a PR says so too.

## Subagent models
- Review: a Sonnet subagent, never Opus. In Claude Code, the `reviewer` agent (`subagent_type: "reviewer"`): it is read-only and already follows the review skill, so the brief names only the target and, without a PR body, the requirement. Elsewhere, the brief tells the subagent to read `~/.claude/skills/review/SKILL.md` and follow it, because the Skill tool can't load that skill for a subagent.
- Research: a Sonnet subagent. Use Opus only when the research is sophisticated: many sources, conflicting facts, or design trade-offs to weigh.

## Working in Herdr
When `HC_TERMINAL_ID` is set, the person watches the Herdr window as well as the chat; use the `herdr` tools.
- Build a branch in a worktree (`worktree_create({ space: false })`), never in the main checkout: other agents work there.
- Never change the person's view (layout, space, tab, focus) unless they ask.
- Scope each brief to about 50 turns, one slice or one review lens; hand over through commits.
- Anything the tools don't cover: `hc --skill` (terminals, other machines), `herdr-app --skill` (window, mods). Edit mods in `~/.config/herdr-app`, then `dot herdr save`.
