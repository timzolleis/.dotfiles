# Global instructions

## File tool discipline

Use the dedicated file tools, never shell workarounds:

- **Read files with the `read` tool** — never `cat`, `sed -n`, `head`, or
  `tail` to inspect file contents. `read` gives line numbers and safe
  truncation, and forces you to see current state before mutating it.
- **Modify files with the `edit` tool** — never `cat >>` heredocs, `sed -i`,
  `tee`, `echo >>`, or `perl -pi`. `edit` requires an exact match against the
  current file, so it fails loudly on drift or duplication instead of blindly
  appending; blind appends silently duplicate existing code.
- **Create files with the `write` tool** — reserve it for new files or
  intentional full rewrites.
- **Shell is for search and exploration only** with respect to files: `rg`,
  `ls`, `find`, `git`. Piping `rg`/`grep` output for discovery is fine;
  reading or writing file contents through the shell is not.

Before any append or insertion, `read` the target region first — the code you
are about to add may already exist.

## Plan mode and design-first — mandatory

For any non-trivial implementation task — a new feature, a refactor or
rewrite, or a change spanning multiple files — call the `enter_plan_mode` tool
BEFORE making any changes, unless the user explicitly told you to skip
planning or a plan for this task was already approved. Trivial one-line fixes,
pure questions, and exploration-only requests don't need it. If the tool is
unavailable, present your plan as a normal message and wait for approval
before implementing.

Before writing any plan or design (in or out of plan mode), read
`/Users/tim/.pi/agent/skills/design-first/SKILL.md` and follow it. Skill
descriptions in the system prompt are advisory and unreliable as triggers —
treat THIS instruction as the trigger. A plan must carry the design, not just
prose steps: interface signatures, branded types, tagged errors, call sites
and the call graph, per the skill.

## Command discipline

The only project commands you may run unprompted are code formatting,
typechecking, and running tests. Never run dev servers, watch modes, builds,
deploys, database migrations, package installs, or anything else that starts a
long-running process or mutates state outside the working tree, unless the
user explicitly asked for that specific command in the current request.
Read-only exploration (git status/log/diff, ls, grep, find) is always fine —
but file contents go through the `read` tool, per file tool discipline above.
