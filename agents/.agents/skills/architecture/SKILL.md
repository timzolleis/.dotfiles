---
name: architecture
description: "How we decide the shape of code before building it: what to remove first, where each piece lives, when to redesign instead of working around, and the plan the user reviews. Use before planning, designing, or restructuring a feature, module, or refactor."
---

# Architecture

Decide the shape before the code: what goes, what exists, and where it lives. `code-style` covers how the code is then written. In Effect code the pattern is `effect-ddd`, with a module to copy; on conflict it wins.

## Subtract first

Before adding, remove what the change makes unnecessary: dead code, a second way to do one task, a guard for a case that no longer occurs. Then build on the smaller base. An addition on top of leftovers has to stay compatible with them, and every later change pays for that again.

- Build only what a current reader uses. A field, index, guard, variant, error, or wrapper for a consumer that doesn't exist yet lands with that consumer.
- Between two designs that solve the problem, take the one that deletes code over the one that adds a layer.

## Shape

Name the data shape first, then the module and layer each piece lives in. With the right types the logic is short; with the wrong ones every function works around them. Complete when every new type and function has a named home.

- **Domain pattern.** Start from the use cases: who wants to do what. Model each state as its own type, decide in pure functions, and keep one core type per module. The full pattern, with a module to copy, is [effect-ddd](~/.agents/skills/effect-ddd/SKILL.md).
- **Dependencies point inward.** The domain imports nothing outside itself. Application code reaches storage and other modules through ports. Infrastructure and transport sit outside and import inward.
- **Edges.** Validate, decode, and map errors once at the boundary (request, config, vendor API, database row); inside it, trust the types.

## Redesign before working around

When a new requirement doesn't fit the design, reshape the design as if the requirement had been there from the start. A flag, a special case, or an adapter around the old shape leaves two designs in the code, and every reader has to learn both.

- Migrate every caller to the new API and delete the old one in the same change; no compatibility layer.
- In a planned rewrite, aim at the end state. A broken intermediate step is fine when the plan names it.
- A name or type with no truthful home is the signal to reshape.

A redesign is the user's decision. Bring the options, what each costs, and a recommendation.

A good turn: "Sharing a template needs an owner, and `SelectionTemplate` has none. Option A: add a nullable `ownerId` and check it in the three use cases that care. Option B: split into `PersonalTemplate` and `SharedTemplate`, so sharing a personal one is a transition. I recommend B: A leaves an owner-less shared template representable. B changes the repository's finds. Which do you want?"

## The plan

A change that adds a module, moves a boundary, or redesigns one gets a plan the user reviews before any code (`plans/<name>.md`). A smaller change states its shape in the reply. Behavior that is new to the domain is first agreed as a story: read [story](~/.agents/skills/story/SKILL.md) completely.

- **Context**: what changes and why; with a story, the use cases and rules it covers, cited from it.
- **Shape**: the module tree (new, changed, and deleted files, one line each on what it owns); the signatures of new and changed types and functions, with their errors; a call tree per use case or entry point. Then **Decisions**, only when there is one: an alternative turned down (`Rejected:`) or a downside accepted (`Cost:`), one line each.
- **Steps**: a checklist, one item per buildable step, removals first; plan review tracks execution by it.
- **Verification**: the test per behavior, and the host's checks.

Submit it in plan mode (`plannotator_submit_plan`); outside plan mode, with the `plannotator` tool and `gate: true`. Build nothing until the user approves it: code written before approval gets rebuilt when they change the design. Once approved it becomes the PR body.

## Principles

Read the matching file completely before applying it, then name the principle that changed a decision.

| Situation | Read |
|---|---|
| Sequencing an addition, refactor, or rewrite | [subtract-before-you-add](~/.agents/skills/principle-subtract-before-you-add/SKILL.md), [laziness-protocol](~/.agents/skills/principle-laziness-protocol/SKILL.md) |
| New requirement into an existing design | [redesign-from-first-principles](~/.agents/skills/principle-redesign-from-first-principles/SKILL.md) |
| New internal API while old callers exist | [migrate-callers-then-delete-legacy-apis](~/.agents/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) |
| Planned rewrite with phase boundaries | [outcome-oriented-execution](~/.agents/skills/principle-outcome-oriented-execution/SKILL.md) |
| Choosing core types, sequencing scaffold vs feature | [foundational-thinking](~/.agents/skills/principle-foundational-thinking/SKILL.md) |
| Stateful logic, growing branches, repeated shape assumptions | [model-the-domain](~/.agents/skills/principle-model-the-domain/SKILL.md) |
| Placing validation, decoding, error handling, or a framework adapter | [boundary-discipline](~/.agents/skills/principle-boundary-discipline/SKILL.md) |
| Cutting the plan's steps, stacking commits or PRs | [sequence-verifiable-units](~/.agents/skills/principle-sequence-verifiable-units/SKILL.md) |
