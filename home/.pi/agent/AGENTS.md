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

## Design conversation first, plan mode second — mandatory

For any non-trivial implementation task — a new feature, a refactor or
rewrite, or a change spanning multiple files — the design is settled IN
CONVERSATION before plan mode is ever entered. Do NOT call `enter_plan_mode`
as a first reaction to a task. The sequence is:

1. **Explore & design in conversation (normal mode).** Read
   `/Users/tim/.pi/agent/skills/design-first/SKILL.md` and run its Phases 0–2
   as a dialogue: explore the codebase, present findings as compact
   summaries/inventories in messages (never as a plan file), sketch the
   design, then grill it — ask the user decision questions, each with your
   recommended answer. Ask about decisions only the user can make
   (requirements, tradeoffs, what to keep vs. kill); never ask what code can
   answer. One decision per message by default; cluster 2–3 only when they
   genuinely touch each other.
2. **Lock gate.** When the open-decision list is empty, propose entering plan
   mode ("design feels locked — enter plan mode?"). Only after the user
   confirms — or explicitly told you to skip the design conversation — call
   `enter_plan_mode`. Never self-decide that the design is locked.
3. **Plan mode transcribes, it does not design.** The plan file is the locked
   design written down: interface signatures, branded types, tagged errors,
   call sites and call graphs, per the skill. If a genuine gap surfaces while
   writing the plan, ask about it — but new design work in plan mode should
   be the exception, not the norm.

Trivial one-line fixes, pure questions, and exploration-only requests need
neither the conversation nor plan mode. If `enter_plan_mode` is unavailable,
present the plan as a normal message and wait for approval before
implementing.

**Small, already-designed work skips plan mode too.** If the task is small in
blast radius (light UI tweaks, small config/setup changes, a handful of
files) AND the design conversation already ran its course with no open
decisions left, don't propose plan mode — state the concrete steps you're
about to take in one short message and go straight to implementing. This is
not a size exemption from designing out loud; it's an exemption from the
plan-file ceremony once that design work is already done. If any open
question remains, or the change fans out across services/layers/contracts,
fall back to the plan-mode gate.

Skill descriptions in the system prompt are advisory and unreliable as
triggers — treat THIS instruction as the trigger for design-first.

**Plan file location.** When a plan file is written into a repository, it
goes in `plans/<descriptive-name>.md` at the repo root — never `PLAN.md` or
any other top-level plan file. Use a short kebab-case name describing the
task (e.g. `plans/consent-flow-rework.md`).

## Command discipline

The only project commands you may run unprompted are code formatting,
typechecking, and running tests. Never run dev servers, watch modes, builds,
deploys, database migrations, package installs, or anything else that starts a
long-running process or mutates state outside the working tree, unless the
user explicitly asked for that specific command in the current request.
Read-only exploration (git status/log/diff, ls, grep, find) is always fine —
but file contents go through the `read` tool, per file tool discipline above.

## Plain-language explanations — default voice

Explain things in chat like one person talking to another, not like
documentation. The test: could the user repeat it to a colleague after one
read?

- **Lead with the point** — first sentence says what's wrong or what it does,
  no setup.
- **Failure story over abstract property** — "report first and crash in
  between? That event is lost for good", not "violates ack-after-apply
  ordering".
- **Everyday words** — "report back" not "ack". Terms of art only when they
  name something in the code, glossed on first use.
- **One idea per sentence; end with the payoff in one line.**

This doesn't loosen precision where it's load-bearing: code, identifiers,
plan files, commit messages stay exact, and skill-mandated vocabularies win
inside their own artifacts. When both matter: plain first, precise term in
parentheses.
