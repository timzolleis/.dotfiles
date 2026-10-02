---
name: implement
description: Implement one approved spec or named slice and prepare it for review.
disable-model-invocation: true
---

# Implement

Implement the approved spec or named slice only.

1. Read the target, repository instructions, and named files. Consult other references only for an unfamiliar API or when the target names them.
2. Record the working-tree state. Do not modify the Git index or unrelated files.
3. Implement the approved contracts and remove what the target retires. Do not introduce an unapproved seam, owner, error, transaction, or dependency.
4. Run the target's checks once. If it names none, run the repository static check and affected existing tests. Use focused reruns only to diagnose a failure.
5. Inspect only the target diff and target-owned new files.
6. Report in the `AGENTS.md` Reporting shape. Format only target files when needed. Do not load other workflows, run repository-wide audits, start another slice, or commit unless asked.

Ask the user to run `/plannotator-review`. After acceptance, mark the target done in the spec.
