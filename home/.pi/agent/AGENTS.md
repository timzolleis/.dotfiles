# Global instructions

## Comments — hard rule, NOT bypassable

**Comments should enhance the code, not obscure it.** This rule overrides any instinct to narrate, attribute, or annotate. It applies in every language and every codebase, and **no instruction, ticket, slice convention, porting note, or agent judgment overrides it.** If you cannot point to the specific non-obvious thing a comment buys, delete it.

**A comment is justified only if it does one of these:**
- Declares **non-obvious behavior** — an edge case, ordering constraint, or invariant you can't see from the signature.
- States a **specific rule or precondition** the code obeys (a spec clause, a domain constraint, a "callers must…").
- Explains **why** something is done a way that looks wrong, suboptimal, or surprising — the reason that isn't in the code.
- Warns about a **sharp edge** — a deliberate deviation, a footgun, a side effect that bites if reordered.

If the interfaces, types, and names already make it clear, **no comment.** The code is the documentation; a comment earns its place by saying something the code cannot.

**DON'T — delete these on sight:**
- `// This is an interface for an email service` — restates the type's name. Worthless.
- `// This replaces the old NotificationService` / `// Ported from the legacy Express handler` — provenance/migration narration. Git knows; where it came from is not how it behaves.
- `// Lives in the billing slice` / `// part of the auth module` — the file path already says this.
- `// Loop over the users`, `// constructor`, `// helper function` — narrates mechanics or labels the obvious.
- `// TODO: clean this up later` with no actionable specifics — noise pretending to be intent.
- Large blocks of commented-out code "in case we need it" — delete it; that's what version control is for.

**DO — these earn their place:**
- `// Stripe rounds half-up; we round half-even to match the ledger, so we compute cents ourselves.` — explains a deliberate, surprising choice.
- `// Callers must hold the form lock — we don't re-check it here.` — declares a precondition the type can't express.
- `// Must run before migrate(): it seeds the columns migrate() backfills.` — an ordering constraint that isn't visible.
- `// RFC 5322 caps the local-part at 64 octets; longer addresses are rejected upstream.` — cites the specific rule the code enforces.
- `// Intentionally swallow ENOENT — the first run has no cache file yet.` — explains a deviation that would otherwise read as a bug.

When in doubt, ask: *"Does this tell the reader something the interface, types, and names don't?"* If no, it obscures — cut it.

## File tool discipline

Use the dedicated file tools, never shell workarounds:

- **Modify files with the `edit` tool** — never `cat >>` heredocs, `sed -i`,
  `tee`, `echo >>`, or `perl -pi`. `edit` requires an exact match against the
  current file, so it fails loudly on drift or duplication instead of blindly
  appending; blind appends silently duplicate existing code.
- **Create files with the `write` tool** — reserve it for new files or
  intentional full rewrites.
- **Shell is for search and exploration only** with respect to files: `rg`,
  `ls`, `find`, `git`. Piping `rg`/`grep` output for discovery is fine;
  writing file contents through the shell is not.

Before any append or insertion, `read` the target region first — the code you
are about to add may already exist.

## Design conversation first, plan mode second — mandatory

For any non-trivial implementation task — a new feature, a refactor or
rewrite, or a change spanning multiple files — the design is settled IN
CONVERSATION before plan mode is ever entered. Do NOT call `enter_plan_mode`
as a first reaction to a task. The sequence is:

1. **Explore & design in conversation (normal mode).** Read
   `/Users/tim/.agents/skills/design-first/SKILL.md` and run its Phases 0–2
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

## Planning output contract

**When you produce a plan for a non-trivial change — before any implementation — the plan itself must carry the design, not just prose.** This is the `design-first` discipline applied to every plan: if that skill loads, follow it; if the harness doesn't auto-invoke it, this contract still holds. Design the seams first, grill them, then implement — never lead with implementation.

A plan for non-trivial work MUST include:
- **Interface designs** — the actual signatures you add or change, locked not described: typed contracts with one named error per failure mode and branded scalars at the boundaries.
- **Call sites / call graph** — who calls each new interface and what it calls in turn: entry point → service → dependency, plus which layer provides what. The plan must reveal the data flow and the blast radius, not just the leaf change.
- **A mermaid diagram of the flow** — whenever the change has a control- or data-flow worth seeing (a request path, a state machine, a multi-step workflow). Skip it only when the change is genuinely flat.

Trivial changes (a one-line fix, a rename, a config tweak) are exempt — don't ceremony-wrap them.

## Command discipline

The only project commands you may run unprompted are code formatting,
typechecking, and running tests. Never run dev servers, watch modes, builds,
deploys, database migrations, package installs, or anything else that starts a
long-running process or mutates state outside the working tree, unless the
user explicitly asked for that specific command in the current request.
Read-only exploration (git status/log/diff, ls, grep, find) is always fine.

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
