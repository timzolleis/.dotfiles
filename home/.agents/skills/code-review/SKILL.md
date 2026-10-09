---
name: code-review
description: Review a working-tree or branch diff against effect-architecture and its originating spec, with proof for every finding.
disable-model-invocation: true
---

# Code review

Review only; edit nothing. Ask two separate questions, so success on one cannot hide failure on the other:

- **Architecture:** is this the simplest code that `effect-architecture`, the repository's `AGENTS.md`, and the existing pieces allow?
- **Spec:** does the change implement the approved behavior, no less and no more?

## 1. Pin the target

Use the user's target. Otherwise: a dirty tree → tracked and untracked working-tree changes; a clean tree → the branch against its merge-base with `main` or upstream; neither → ask. State the target.

Complete when the target is explicit and backed by inspected Git state.

## 2. Load the sources

Read the repository's `AGENTS.md`, the approved spec (say so when none exists, and skip only the spec axis), `effect-architecture/SKILL.md`, and its reference for every module kind the diff touches.

For every new function, type, error, codec, fixture, or service, search for the *concept*, not only its new name. An equivalent existing owner is a Blocker until the change reuses or extends it. Record each probe.

## 3. Architecture axis

Trace each changed value through `input → codec → policy/decision → transition → effects → result or failure`. Check tenancy (`AuthorizedOrganizationId`, visibility predicates), race guards, transaction lifetime, idempotency, and personal data in diagnostics. Moved, renamed, and extended code is part of the diff and is judged like new code (`effect-architecture`, Refactors). Read each hunk in this order and stop at its first substantive issue:

1. **Existence:** a duplicate, a pass-through that fails the deletion test, a one-use helper, a speculative seam.
2. **Domain shape:** a representable illegal state, a rule outside its owner, a read model that spreads a state, a domain type that knows a wire shape or a table.
3. **Layer:** a decision in a repository or handler, a write called from a handler, a mapper where a codec belongs, a network call inside a transaction.
4. **Edges:** undecoded input, `catchTags` instead of a `*HttpError` codec, a response derived from domain fields, a transform where field codecs suffice.
5. **Effect idioms:** an expected failure hidden as a defect, ambient time or randomness, sequential independent work, a swallowed interruption, a root `effect` import.
6. **Names and contracts:** anything that breaks `effect-architecture/naming.md`.
7. **Readability:** anything that breaks "Less code" or "Readable code" in `effect-architecture/SKILL.md`: a comment the code could show, a helper Effect or Schema already provides, nesting where an early return reads flat, a function mixing levels, a file that reads bottom-up, a split file without a second reader.
8. **Tests:** a test the spec did not approve, a claim proven at the wrong seam, an assertion that echoes its input or fake.

## 4. Prove, then try to disprove

A finding survives only with proof: the quoted code with path and line range, plus a value flow, a reachable state, or a reproduction with its observed result. Then try to disprove it: does a codec, a Layer, or surrounding code already handle it? Local precedent excuses only code the diff leaves alone. Is it only a preference? Downgrade an unproven finding to **Question**, or drop it.

## 5. Spec axis

Quote the governing spec line for each item: **Missing**, **Scope creep**, **Wrong** (present but behaves differently), or **Silent decision** (an approved interface, dependency, persistence strategy, effect order, or scope changed without returning to design). Style is never a spec failure.

## 6. Report

```md
Review target: <target>
Loaded: <AGENTS.md, spec, effect-architecture references>
Reuse probes: <concept> → <search> → <hit | none>

## Architecture
### <Blocker | Should fix | Simplification | Nit | Question>: <title>
- **Where:** `<file>:<line>`
- **Rule:** <reference and rule | judgement call>
- **Code:** <quoted excerpt>
- **Proof:** <value flow, reachable state, or reproduction>
- **Fix:** <direction, with a sketch unless the fix is a deletion>

## Spec
### <Missing | Scope creep | Wrong | Silent decision>: <title>
- **Spec:** `<path>:<line>` · **Where:** `<file>:<line>` · **Proof:** <difference> · **Fix:** <direction>

Summary: <count and worst finding per axis>
```

No praise, no diff recap. Complete when both axes are reported and every finding survived disproof; then ask the user to run `/plannotator-review`.
