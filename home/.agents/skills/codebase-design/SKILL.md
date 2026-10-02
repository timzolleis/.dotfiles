---
name: codebase-design
description: Design a change together with the user — a feature, an integration, or a refactor — growing its spec one locked decision at a time until it goes to Plannotator. Use when a change touches something other code or people depend on and is too large to just do.
---

# Codebase design

## The ideal shape

We start from what exists, if anything: how it works today and what it has to keep. Then we agree on the use cases we want to offer: what people *do* (commands) and what they want to *know* (questions). The use cases give us the language: the core types, their states, the verbs. Verbs become service commands, and questions become reads. Everything after that (repositories, codecs, helpers) follows from those and is mostly mechanical. We discuss each decision as it comes up, and the spec grows with every decision we lock.

Real changes rarely follow this exactly. Treat it as the direction, and use the moves below to get there by whatever route the change needs.

## The rule

**Take next the decision other decisions depend on.** Say which move you are making and why, so the user can redirect. Each decision follows the pairing loop in `AGENTS.md`; the architecture behind every proposal is `effect-architecture`.

## Moves

| Move | Use when | Output |
|---|---|---|
| Map what exists | there is code, a schema, or consumers to respect | current call trees, fixed constraints (wire contracts, schema, consumers), pain points |
| Use cases | the intent is fuzzy | actor + intent, each marked command or question |
| Name it | terms are vague, overloaded, or new | terms written into `CONTEXT.md` as they lock ([context-format.md](context-format.md)) |
| Lifecycle | something has states | state diagram, the rule on each transition (a type, a policy, or a guard) |
| Interface | callers will depend on it | signatures for service commands and read models |
| Call tree | a path changes | diff call tree, with its tests |
| Edges | data crosses HTTP, the database, or an external system | codecs and errors, only the ones that are not mechanical |
| Design it twice | the shape is unclear or contested | 2–3 radically different interfaces, compared ([design-it-twice.md](design-it-twice.md)) |
| Grill | a design feels settled | read `~/.agents/skills/grill/SKILL.md` completely and follow it |

Use-case wording maps onto the architecture: a noun becomes a core type, a phase a state, a verb on a state a transition, "sees" or "counts" a question, and "only if" the rule on a transition.

## The spec

A change that fits one context and adds no dependency needs no spec: lock it in conversation, implement it, report, and ask for `/plannotator-review`. Anything larger gets `plans/<change>.md`, created with the first locked decision.

- **Write only what was locked, right after it locks**, and say in one line what changed in the spec. The user never meets a section they have not already agreed to.
- **Every spec contains**:
  - **Decisions**: a table of decision, trade-off, and rejected alternative.
  - **Call trees** for every changed path, each followed by its tests in the defense format of `effect-architecture/testing.md`.
  - **Slices**: a `## Slices` section of `- [ ] 1. <Title> — <what it delivers and its checks>` lines, which `/implement` parses.
- **Add other sections only when their move was made**: use cases, lifecycle, interface, edges.
- **A spec records decisions, never new ones.** When writing it surfaces an open question, ask before continuing.

## Review and build

1. When nothing is open and the slices are written, enter Plannotator plan mode and submit the spec.
2. Apply wording fixes from annotations directly. Discuss an annotation that reopens a locked decision one at a time, update the spec, and resubmit.
3. After approval, the user runs `/implement` per slice and reviews each with `/plannotator-review`.
4. Delete the spec once its last slice lands. Plannotator's archive keeps the history; `CONTEXT.md` keeps the language.

Complete when the spec is approved, or when an inline change has been implemented and reported.
