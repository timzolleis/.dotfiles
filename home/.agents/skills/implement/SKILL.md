---
name: implement
description: Implement one approved spec or named slice and prepare it for review.
disable-model-invocation: true
---

# Implement

Implement the approved spec or the named slice only. The spec is the full scope; its decisions are not reopened here.

1. Read the target, the repository's `AGENTS.md`, and the files the target names. Read other references only for an unfamiliar API or when the target names them.
2. Record the working-tree state. Do not modify the Git index or unrelated files.
3. Implement the approved contracts and remove what the target retires. Introduce no seam, owner, error, transaction, dependency, or test the spec does not name. When the code contradicts a locked decision, stop and report it as `Needs decision`.
4. Write each test the slice names, as its defense describes, and prove its sensitivity as `effect-architecture/testing.md` requires. When the user asks for the slice test-first, read `~/.agents/skills/tdd/SKILL.md` completely and follow it for steps 3 and 4.
5. Run the slice's checks once. When it names none, run the repository's static check and the affected existing tests. Rerun narrowly only to diagnose a failure.
6. Inspect only the target diff and the target-owned new files.
7. Report in the `AGENTS.md` shape, adding `Sensitivity - <test>: RED <result>; GREEN <result>` per new test. Do not load other workflows, run repository-wide audits, start another slice, or commit unless asked.

Complete when the slice's checks pass and every new test has a recorded sensitivity proof. Ask the user to run `/plannotator-review`; after acceptance, tick the slice (`- [x]`) in the spec. When the last slice is accepted, delete the spec.
