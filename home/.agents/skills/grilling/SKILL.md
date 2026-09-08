---
name: grilling
description: Stress-test a plan, decision, or design as a dependency-ordered design tree.
disable-model-invocation: true
---

# Grilling

Interview the user until you reach shared understanding. Map unresolved choices as a **design tree**: each decision branches into the decisions that depend on it.

Work in rounds. The **frontier** is every decision whose prerequisites are settled and can be asked now without guessing.

For each round:

1. Ask the full frontier.
2. Number every question.
3. Give your recommended answer and reason for each.
4. Wait for the user's answers.
5. Recompute the tree and ask the next frontier.

```text
❓ Q1 — <decision title>: <question, choices, and consequences>

➡️ Recommendation: <answer and reason>
```

A question whose answer depends on another open question belongs in a later round.

Finding facts is the agent's job. Read files, documentation, tools, and source instead of asking the user for facts available in the environment. The user owns requirements and trade-offs; ask those and wait.

Finish when the frontier is empty and the user confirms shared understanding. Do not implement the design from this skill.
