---
name: test-review
description: Audit permanent tests as maintained code; defend their confidence and lifetime cost, then cut, move, merge, or fix them only after human approval.
disable-model-invocation: true
---

# Test review

Audit first; edit nothing until the user approves the verdicts. Read `effect-architecture/testing.md` before assigning any: it owns the premise, the six admission questions, and where each decision is tested.

## 1. Pin the target and load evidence

Use the user's target. Otherwise: test files in the dirty tree, else test files changed against the merge-base with `main`, else ask. Read the repository's `AGENTS.md`, each target test, enough of its production module to name the decisions it owns, existing tests of the same decision at any seam, and the fixtures and fakes involved. A unit whose only caller is its test is dead code; report it.

Complete when every target test is paired with the production decision it claims to cover.

## 2. Check the rig

Using the testing map, flag a database proving a service or handler decision, an HTTP server proving a domain, codec, or repository decision, rendered UI proving a non-rendered decision, a fake standing in for SQL or runtime behavior, and module patching, spies, or uncontrolled time, IDs, or randomness.

## 3. Defend each test and assign a verdict

For every test, record the answers to the six questions, mark the assertions that do not support the claim, and assign one verdict:

| Verdict | Meaning |
|---|---|
| **Keep** | the defense is complete; retention still needs approval and a sensitivity proof |
| **Merge** | another test buys the same confidence; keep the lower-burden one |
| **Move** | the confidence is material, but another seam owns it |
| **Cut** | no material regression, evidence gap, or maintainable confidence |
| **Fix** | the claim is valid, but evidence, assertions, name, rig, or determinism is wrong |

Common reasons to cut, move, or fix: **fake echo** (repeats a configured return), **input echo** (repeats fixture data without an owned conversion), **incidental identity**, **library proof**, **type proof**, **mapper restatement**, **pass-through**, **assertion-free path**, **duplicate confidence**, **private reach**, **oversized rig**, **static rendering**, **uncontrolled input**. Coverage, changed lines, and layer symmetry never justify a test.

## 4. Review fixtures and fakes

Support code is maintained code too. Search for an existing fixture or fake before proposing one; keep one-off setup local; share setup only when one domain concept recurs; build values through production schemas; drop fields neither the setup nor the claim needs.

## 5. Report and stop

```md
Review target: <paths>
Existing-evidence probes: <claim> → <search> → <hit | none>

| File / test | Verdict | Regression | Claim + seam | Gap | Burden | Sensitivity | Action |
|---|---|---|---|---|---|---|---|

Assertion cuts: <test> — <assertion> — <why removal keeps the claim>
Rig findings: <file> — <claimed seam> — <actual rig> — <lower seam>
Fixture and fake findings: <support code> — <burden> — <action>
Left untested on purpose: <behavior> — <reason>
```

Ask the user to approve, adjust, or reject. An approval covers only the listed claim, seam, burden, and sensitivity change.

## 6. Apply approved verdicts

Apply the approved cuts, moves, merges, and fixes. For each retained test, prove its sensitivity as `effect-architecture/testing.md` requires, using the narrowest command. When a test does not fail for the claimed reason, restore and stop for a decision. Never leave a mutation in the tree; run the repository's checks.

Report in the `AGENTS.md` shape, adding `Sensitivity - <test>: RED <result>; GREEN <result>` per retained test.
