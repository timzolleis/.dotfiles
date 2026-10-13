---
name: grill
description: Stress-test a plan, decision, or design as a dependency-ordered design tree, sharpening the domain language as it goes.
disable-model-invocation: true
---

# Grill

Grilling is pairing with the pressure turned up: the user brings a plan and wants every weak spot found before it is built. The goal is shared understanding and a design in which every decision is locked. Pairing works as in `AGENTS.md`; the architecture you push against is `effect-architecture`.

Map the open decisions as a design tree: each decision branches into the ones that depend on it. The **frontier** is what can be decided now without guessing. Work the frontier one decision at a time, or a small group that belongs together: name the weak spot, recommend an answer, show the trade-off, and ask whether the user agrees. Then recompute the tree.

Push on what the plan assumes rather than what it states: the failure nobody owns, the caller who breaks, the invariant that holds only by convention, the state that is representable but illegal. A question the codebase can answer is not a question; look it up.

## Language

Grilling sharpens the domain language as much as the design:

- **Challenge against the glossary.** When a term conflicts with `CONTEXT.md`, say so at once: "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"
- **Sharpen fuzzy words.** For a vague or overloaded term, propose one canonical term.
- **Test with concrete scenarios.** Invent cases that probe the edges between concepts and force precision.
- **Cross-check with the code.** When the user states how something works and the code disagrees, surface the contradiction.
- **Write locked terms into `CONTEXT.md` immediately**, in the format of `~/.agents/skills/codebase-design/context-format.md`. It holds terms only, never implementation decisions.

## Finish

Complete when the frontier is empty and the user confirms the plan is locked. Grilling does not implement. When it runs inside `codebase-design`, write the locked decisions into the spec; otherwise, if the result is too large for one context, continue with `codebase-design`.
