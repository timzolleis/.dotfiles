---
name: implement
description: Implement one approved spec or named todo, verify it, and review the resulting diff.
disable-model-invocation: true
---

# Implement

Implement only the approved spec or named todo supplied by the user.

Before editing:

- Resolve and read the exact target, applicable instructions, agreed references, and relevant coding standards.
- Inspect the working tree and preserve unrelated changes.
- Stop and ask when the target is missing or ambiguous.
- Stop for a decision when the target conflicts with repository rules or requires an unapproved interface, dependency, persistence, or scope change.

Read `/Users/tim/.agents/skills/tdd/SKILL.md` completely and use it at pre-agreed seams. Run focused tests and typechecking regularly, then run the full affected checks at the end.

Once implementation passes its checks:

1. Read `/Users/tim/.agents/skills/code-review/SKILL.md` completely and use it against the actual working-tree diff and originating spec.
2. Present the separate Standards and Spec findings.
3. Ask the user to invoke `/plannotator-review`; only the user starts human review of the actual diff.
4. Apply feedback and repeat checks and review until the user accepts the change.

Do not implement follow-on todos. Do not commit unless the user asks.
