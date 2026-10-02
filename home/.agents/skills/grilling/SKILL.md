---
name: grilling
description: Stress-test a plan, decision, or design as a dependency-ordered design tree.
disable-model-invocation: true
---

# Grilling

Grilling is pairing (`AGENTS.md`, How we work) with the pressure turned up: the user brings a plan and wants every weak spot found before it is built. The goal is shared understanding and a design where every decision is locked.

Map the open decisions as a design tree — each decision branches into the ones that depend on it. The frontier is what can be decided now without guessing. Work the frontier one decision at a time, or a small group that belongs together: name the weak spot, recommend an answer, show the trade-off, and ask whether the user agrees. Then recompute the tree.

Push on what the plan assumes rather than what it states: the failure nobody owns, the caller who breaks, the invariant that only holds by convention. A question the codebase can answer is not a question — look it up.

Finish when the frontier is empty and the user confirms the plan is locked. Grilling does not implement; if the result is too large for one context, it hands off to `tech-spec`.
