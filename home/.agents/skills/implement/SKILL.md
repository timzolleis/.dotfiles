---
name: implement
description: Implement one approved spec or one of its slices end to end, verify it, and review the diff. Use when the user invokes /implement <spec-path> [slice].
disable-model-invocation: true
---

# Implement

Build the named spec or slice. All of it, one pass, nothing else.

## Target

`/implement <spec-path>` — the whole spec, or a spec block pasted in the message.
`/implement <spec-path> <slice>` — one entry from the spec's `Slices` section, plus the spec sections it cites.

Stop and ask when the target is missing or ambiguous, or when an earlier slice it depends on is not yet done.

Complete when one named target owns every file this run will touch.

## Context

Read, in this order:

- the spec, and for a slice the sections it cites — this is the contract;
- the repository instructions;
- the reference implementation the repository names for this kind of work;
- the pinned library source for every unfamiliar API, matching the installed major.

Then open the files the spec names and check the symbols still match the working tree. Preserve unrelated changes.

Do not load standards prose on top of the spec. The spec already settled the decisions those documents inform.

Complete when every contract the slice owns or consumes, every call path through it, and the current state of every file it touches are known.

## Implement

- Keep the contracts, effect order, and failure propagation the spec shows.
- Read `/Users/tim/.agents/skills/tdd/SKILL.md` completely and work in RGR slices at the seams the spec names.
- Delete what the spec says disappears. Do not leave a bridge behind.
- Run focused tests and typechecking as work progresses.

Local mechanics are yours. A new contract, seam, owner, error, transaction, or dependency is not. When the spec does not answer a question you must answer, answer it, keep moving, and report it as a deviation — do not silently absorb it and do not stall.

Stop and return to the spec only when continuing would contradict an approved contract or a repository rule.

Complete when the slice satisfies its contract, its call paths are intact, and nothing the spec retired is still reachable.

## Verify and review

1. Run the repository's required checks and the affected tests. Record exit codes.
2. Read `/Users/tim/.agents/skills/code-review/SKILL.md` completely and review the working-tree diff against the spec. Load the `/Users/tim/.agents/skills/coding-standards/` topic files matching what changed. Present spec findings and standards findings separately.
3. Report using the block in `AGENTS.md`.
4. Ask the user to run `/plannotator-review`. Only the user starts human review.
5. Apply feedback in a fresh context seeded with the review payload. Repeat until accepted.
6. On acceptance, mark the slice done in the spec's `Slices` section and record its outcome on that line.

Complete when review is accepted, every check has an observed exit code, and every decision the spec did not contain appears in the report.

Do not start the next slice. Do not commit unless asked.
