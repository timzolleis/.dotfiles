---
name: code-review
description: Review a working-tree or branch diff separately against coding standards and its originating spec.
disable-model-invocation: true
---

# Code Review

Review only. Do not edit the workspace. Ask two separate questions:

- **Standards:** is this the simplest domain-shaped code that existing pieces and repository rules require?
- **Spec:** does the change implement the requested behavior, no less and no more?

Keep the axes separate so success on one cannot hide failure on the other. Complete both directly with the available context and tools. Do not claim independent or parallel reviewers unless the harness actually supplies them.

## 1. Pin the target

Use the target the user supplied. If none:

1. dirty tree → review tracked and untracked working-tree changes;
2. clean tree → review the branch against the merge-base with `main` or its upstream;
3. no valid target → ask for one.

For a branch target, resolve it with `git rev-parse`, then capture `git diff <fixed>...HEAD` and `git log <fixed>..HEAD --oneline`. For a dirty tree, inspect `git diff`, `git diff --cached`, and untracked files. Fail on a bad reference or empty target.

## 2. Load the sources

Read, in priority order:

1. nearest repository instructions;
2. the originating approved plan, issue, or spec;
3. applicable coding-standard references;
4. the most recent compatible implementation for every changed layer.

If no spec exists, say so and skip only the Spec axis.

## 3. Probe reuse before style

For every new function, constant, type, model, error, mapper, formatter, label map, fixture, component, service, and adapter, search for the concept rather than only its new name.

Common probes:

| New thing | Search |
|---|---|
| dates | existing date models and formatters |
| labels | enum, labels, and i18n helpers |
| row/model mapping | existing codecs and boundary transforms |
| UI state/list/card/dialog/toast | shared UI components |
| error | domain error packages |
| test data | shared fixtures |

Record each probe and its result. An equivalent existing owner is a blocker until the change reuses or extends it.

## 4. Trace each changed behavior

Follow changed values and effects through the full call path:

```text
input → parse → domain decision → service effect order → adapter → result/failure
```

Check organization or owner scope, retries and idempotency, transaction lifetime, secrets and PII, and the public test seam where relevant.

## 5. Standards axis

Read each hunk in this order and stop at its first substantive issue:

1. **Existence:** duplicate, pass-through module, one-use helper, or speculative seam.
2. **Compensation:** codec rename, field override, null filtering, pre-read before write, manual timestamp, unnecessary transaction, or manual cascade that should be fixed upstream.
3. **Domain shape:** business meaning outside the domain owner, invalid state representable, hand-copied schemas or unions, unparsed boundary data, or new vocabulary for an existing concept.
4. **Layer:** rule/default/second call in a handler or repository, forwarding service, broad dependency, row exposed to UI, network call inside transaction, or retryable mutation without idempotency.
5. **Idioms and safety:** project-forbidden escape hatch, hidden expected failure, ambient time, sequential independent work, swallowed interruption, floating promise, or sensitive data in diagnostics.
6. **Names and contracts:** undiscoverable export, duplicate definition, a name, signature, comment, or test name that is untrue or stale under AGENTS.md "Truthful contracts", or a comment that does not add information.
7. **Tests:** decision tested in the wrong layer, mocked unit under test, raw setup instead of fixtures, or implementation-coupled assertion.

Every finding needs:

- a repository rule or clearly labelled judgement call;
- an exact path and line range;
- real code;
- a value flow, reachable state, or reproduction proving the effect;
- the upstream fix direction.

Try to disprove each finding against surrounding code and local precedent. Drop anything that does not survive.

## 6. Spec axis

Quote the governing spec line for each item:

- **Missing:** required behavior absent or partial.
- **Scope creep:** behavior or surface not requested.
- **Wrong:** requirement appears present but its observable behavior differs.
- **Silent decision:** implementation changed an approved interface, dependency, persistence strategy, effect order, or scope without returning to design.

Do not recast style preferences as spec failures.

## 7. Report

```md
Review target: <target>
Standards loaded: <paths>
Spec loaded: <path | none>
Reuse probes: <concept> → <search> → <hit | none>

## Standards

### <Severity>: <title>
- **Where:** `<file>:<line>`
- **Rule:** <source and rule | judgement call>
- **Code:** `<actual excerpt>`
- **Proof:** <observable consequence>
- **Fix:** <direction>

## Spec

### <Missing | Scope creep | Wrong | Silent decision>: <title>
- **Spec:** `<path:line>`
- **Where:** `<file:line>`
- **Proof:** <difference>
- **Fix:** <direction>

Summary: <count and worst finding for each axis>
```

Severity: **Blocker**, **Should fix**, **Simplification**, **Nit**, or **Question**. Keep findings concise. No praise, no diff recap, and no edits.

After reporting both axes, ask the user to invoke `/plannotator-review` for human review of the actual diff. The active agent does not start or impersonate that review.
