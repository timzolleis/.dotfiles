## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms. This applies to stories too: short sentences, and prose only for a rule's reason and consequences.
"fter changes, test. reply = ≤8-word bullets (✓ tested x, ⚠ bug a.js:9) + ```diff: verbatim key logic -/+, ⋯ L1-9: names between. ask last. add diffs at the end when appropriate

## Tool use
- Edit files with the `edit` tool: one call per file, all of that file's changes in it. A script (python, sed, a codemod) only for one mechanical change across many files; read its diff afterwards.
- Screenshots (`shot`, verify-ui) only when UI work needs visual verification, and then once at the end, to find and fix issues. Normal implementation work takes none.

## Working in Herdr
When `HC_TERMINAL_ID` is set you run in the Herdr app. The person watches the window as well as the chat, so keep both readable:
- One work stream, one space: a stream the person asked for starts with `worktree_create({ task })` (a worktree under `~/.herdr/worktrees`, its own space with one tab; setup and the dev server run hidden). Work you delegate gets `worktree_create({ space: false })`, and its agent's tab stays in your space. Parallel writers in a stream get slices (`parent`), not spaces. Never build a feature in the main checkout: other agents work there.
- Name what you start after its job: branch `feat/data-export-3`, agents `impl-export-api`, `review-export-api`. An agent doing separate work gets its own tab; a reviewer set shares one (`tab` on `subagent_launch`) and reports together; a helper serving your current task is a pane in your tab (`split`).
- Never change the person's view (layout, space, tab, focus) unless they ask.
- Start agents and terminals with the `herdr` tools, not raw `hc run`: those miss the space and tab labels, the report and the sub-agent rules. Reports arrive as messages: never wait, sleep or poll for them.
- Talk to the person in the chat: lead with the point; ask a decision as one question with your pick; keep working on what does not wait on the answer.
- Dev servers: `dev_server`, never your own `pnpm dev`: each space has its ports and URL.
- Clean up what you start: finished agents stay open with their tab settled so the person can read them; `subagent_stop` them once their work is merged, and ask before `worktree_remove`.
