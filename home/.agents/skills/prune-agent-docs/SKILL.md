---
name: prune-agent-docs
description: Audit and rewrite a repo's agent documentation (CLAUDE.md, patterns/, rules files) against the actual codebase and the global standards tiers — cutting stale facts, duplication, and tutorial bloat so the docs steer instead of misleading. Use when the user says the agent docs have slop/bloat/drift, asks to clean up or slim down CLAUDE.md or pattern docs, or complains that generated code ignores the documented conventions.
---

# Prune Agent Docs

Agent docs rot in a specific way: they stay *plausible* while becoming *wrong*. This skill audits every claim against the code, deletes what the standards tiers already own, and rewrites what remains into lean contracts that point at real reference implementations.

## Why docs cause slop (the failure model)

Diagnose before cutting — each mechanism has a different fix:

1. **Inaccuracy destroys authority.** When an agent follows a doc into a nonexistent file, a renamed helper, or a dead link, it learns within minutes that the docs are unreliable — and it can't tell which half is stale, so it discounts *everything* and freelances. A doc that contradicts the code is worse than no doc: you pay the context cost and lose the steering. Fix: verify every claim; delete or correct.
2. **Mechanical guidance without judgment.** Docs that only say *how to build a layer* — never *when not to*, *where logic belongs*, or *what to reuse* — teach agents that building scaffolding is the job. Fix: add altitude rules (see TEMPLATES.md) at the always-loaded tier.
3. **The maximal shape presented as the default shape.** A worked example showing every layer of the full pattern gets copied whole, even for features needing two of nine artifacts. Fix: state explicitly when layers may be skipped ("keep it anemic unless…").
4. **Essay format burns attention.** Persuasive docs re-arguing an already-made architecture decision (history, analogies, unbuilt future designs) drown the load-bearing rules. When everything is emphasized, nothing is. Fix: keep the contract and the traps; cut the argument.

## Phase 1 — Inventory and ground truth

- List every agent-facing doc: root `CLAUDE.md`, `patterns/`/`docs/` rule files, nested `CLAUDE.md`s, `.cursor/rules`, etc. Record line counts for the before/after report.
- Identify the standards tiers above the repo: user-global `~/.pi/agent/AGENTS.md` and the global **`coding-standards`** skill. For the skill, `ls ~/.agents/skills/coding-standards/` and read **every topic file whose subject the repo docs touch** (`EFFECT.md`, `TESTING_AND_VERIFICATION.md`, `DOMAIN_MODELING.md`, `ERROR_HANDLING.md`, `DESIGNING_MODULES.md`, `BOUNDARIES_AND_PARSING.md`, `ASYNC_AND_WORKFLOWS.md`, `OBSERVABILITY.md`, `TYPESCRIPT_CONTRACTS.md`, …) — **not just the root `SKILL.md`**, which is only a routing summary; real conflicts hide in the topic files' details. Also read `ADAPTATION.md` if present: it records deliberate local deltas (e.g. which conventions were synced from the global AGENTS.md), which tells you the direction of truth when the tiers disagree. Dedup targets and conflict checks both come from this read.
- Verify **every checkable claim** against the repo (Explore agents work well for the fan-out):
  - commands vs actual `package.json` scripts (every workspace);
  - paths, directory layouts, app names vs the tree;
  - every code identifier a doc mentions (helpers, layer names, hooks, tags) via grep — the doc's `handlePrismaError` may be the code's `narrowPrismaError`;
  - code samples vs real call sites (import paths, API shapes, hook names);
  - "status"/"to build" claims vs what shipped (check `git log` — recent landings are what docs miss most);
  - every relative link resolves.
- File anything that fails as **stale**, with the verified truth next to it.

## Phase 2 — Classify every block

For each section of each doc, assign one verdict:

- **KEEP** — project-specific contract, invariant, or earned trap a competent model would *not* reconstruct from code + global standards. (Publish-after-save ordering, idempotence traps, "two event systems, not interchangeable", composition-root locations.) The sharpest earned knowledge — usually the traps/pitfalls sections — survives nearly whole.
- **DELEGATE** — owned by a global tier. Replace with a one-line pointer. Duplicated conventions drift; one authoritative copy wins. If the *project deliberately deviates* from the global standard, that's a KEEP with teeth: state the deviation and its rationale explicitly so a standards-following agent doesn't "correct" it back.
- **FIX** — right idea, stale facts. Rewrite against the verified truth from Phase 1.
- **CUT** — fails the cut test: *"Could a competent model infer this from the code and the global standards?"* Tutorials for well-known libraries, restated generic principles, per-variant boilerplate examples, provenance narration, persuasion essays, and specs for **unbuilt** systems (describe what exists; unbuilt directions get ≤3 lines or nothing).

## Phase 3 — Rewrite to the two-tier structure

Use the skeletons in [TEMPLATES.md](TEMPLATES.md).

**Tier 1 — always-loaded CLAUDE.md (~80–120 lines).** Carries only what must hold even when nothing else is read: accurate commands; structure map; a **layer-ownership table with a "must not" column** (answers "where does this code go" — the #1 slop question); the **altitude rules** (anti-slop judgment, one rule per observed failure mode); the project's mandatory conventions incl. declared deviations from global standards; a one-line-per-doc pattern index; a delegation line pointing everything generic at the global tiers.

**Tier 2 — pattern docs (~80–150 lines each).** Each is *contracts + traps + a pointer to a real reference implementation* — never a tutorial. Name the best real implementation ("Reference: `deployment-user`") and condense examples **from that code**; code can't drift from itself, 200-line inline pseudo-code can. State when the pattern does NOT apply and which layers may be skipped. Merge thin docs that cover one flow (e.g. collections + forms → one frontend doc).

Keep deliberate redundancy only at Tier 1: a rule may appear in both CLAUDE.md and a pattern doc only if it's load-bearing enough to pay for twice.

## Phase 4 — Verify and report

- Grep all docs for dead links and for every stale name found in Phase 1 — zero hits required.
- Re-grep code identifiers mentioned in the rewritten docs — every one must exist in the repo.
- Report: per-file before/after line counts; every conflict found between project docs and global standards and how it was resolved (fixed vs declared deviation); every **gap surfaced** — things the docs promised that don't exist (missing sweeps, unregistered handlers, unbuilt machinery). Gaps are findings for the user, not things to silently paper over.
- Docs have no runtime surface — nothing to typecheck; the greps are the verification.

## Judgment calls to make deliberately

- **Don't gut the user's own recent rewrites** — if a doc is already accurate and rule-dense, it's the template, not a target. Ask or leave it.
- **Slop in reference-adjacent code teaches by counterexample** — if the files docs point at contain slop comments or legacy shapes, flag them to the user (cheap, high-leverage cleanup), don't expand the docs to compensate.
- **Docs steer; they don't gate.** If the user wants enforcement, suggest review skills or hooks separately — don't bloat the docs into a linter.
