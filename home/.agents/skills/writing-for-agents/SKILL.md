---
name: writing-for-agents
description: Create or revise skills, AGENTS.md, CLAUDE.md, and other instructions consumed by agents.
disable-model-invocation: true
---

# Writing for Agents

Use this reference for every document an agent consumes. Make the process predictable without forcing all reference material into every turn.

When editing a skill, also read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## Context pointers

A **context pointer** names material outside the current context and says when to read it. A skill description and an instruction such as “for persistence changes, read X” both act as pointers.

A useful pointer:

- starts with the concept that should trigger it;
- names each distinct branch that needs the target;
- avoids repeating identity or detail already present in the target.

A required document behind a vague pointer is unreliable. Sharpen the pointer before copying the document into always-loaded instructions.

## Two loads

- **Context load:** material present on every turn, including global instructions and skill descriptions.
- **Cognitive load:** material the human must remember and invoke.

Spend context on rules the agent must apply automatically. Spend cognitive load where the human should choose the activity.

## Information hierarchy

Put material at the lowest level that still makes it reliable:

1. **In-file step:** ordered work required on every run.
2. **In-file reference:** rules consulted during that workflow.
3. **Disclosed reference:** branch-specific material in another file behind a precise pointer.

Inline what every branch needs. Move branch-specific reference behind a pointer. Keep each concept's definition, rules, and caveats together.

## Steps and completion criteria

End each step with a checkable condition. A completion criterion must tell the agent exactly when the step is complete and demand enough evidence to prevent early exit.

Prefer:

```text
Complete when every changed boundary has a named parser and test seam.
```

Avoid:

```text
Understand the boundaries thoroughly.
```

Split a workflow only when seeing later steps causes the agent to rush the current one, or when separate invocation requires separate human intent.

## Leading words

Use stable terms that already carry the intended behavior: **frontier**, **tracer bullet**, **deletion test**, **red**, **seam**. Reuse the term instead of restating its definition at every site.

State the positive target behavior. Use prohibitions only for hard guardrails and pair them with what the agent should do instead.

## Pruning

- Keep one authoritative home for each rule.
- Treat package scripts, configuration, types, and directory layout as sources of truth; do not cache easy lookups in prose.
- Remove stale, irrelevant, duplicate, and default-behavior instructions.
- Prefer a precise pointer over duplicated reference text.
- Test whether an instruction changes model behavior before expanding it.

Complete when every retained line has one owner, one trigger or workflow role, and a checkable effect on agent behavior.
