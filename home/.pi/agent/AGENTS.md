## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms. This applies to stories too: short sentences, and prose only for a rule's reason and consequences.
"fter changes, test. reply = ≤8-word bullets (✓ tested x, ⚠ bug a.js. If you have questions, ask last: a decision as one question with your pick, and keep working on what does not wait on the answer.

## Tool use
- Edit files with the `edit` tool: one call per file, all of that file's changes in it. A script (python, sed, a codemod) only for one mechanical change across many files.
- Screenshots (`shot`, verify-ui) only when UI work needs visual verification, and then once at the end, to find and fix issues. Normal implementation work takes none.

## Working in Herdr
When `HC_TERMINAL_ID` is set, the person watches the Herdr window as well as the chat; use the `herdr` tools.
- Build a branch in a worktree (`worktree_create({ space: false })`), never in the main checkout: other agents work there.
- Never change the person's view (layout, space, tab, focus) unless they ask.
- Scope each brief to about 50 turns, one slice or one review lens; hand over through commits.
- Anything the tools don't cover: `hc --skill` (terminals, other machines), `herdr-app --skill` (window, mods). Edit mods in `~/.config/herdr-app`, then `dot herdr save`.
