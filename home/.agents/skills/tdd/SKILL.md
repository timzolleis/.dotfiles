---
name: tdd
description: Test-driven development through the seams and claims an approved spec names, in vertical red → green tracer bullets.
disable-model-invocation: true
---

# Test-driven development

TDD is a red → green loop through public interfaces. Each test proves one claim the spec approved; `effect-architecture/testing.md` owns what is tested where, the six admission questions, and the test doubles.

## 1. Take the seam and claims from the spec

List the tests the spec names under each call tree: claim, seam, rig. Check each against the six admission questions before writing it. When a seam is missing, disputed, or a needed test is not in the spec, stop and raise it instead of inventing it.

Complete when every test you will write maps to one approved defense.

## 2. Run vertical slices

For each claim, in the order the spec's call trees suggest:

1. **Red:** write one test through the public interface and run it; observe it fail for the claimed reason.
2. **Green:** add only enough implementation to pass it.
3. Run the focused test and the type check.
4. Move to the next claim, using what this one taught you.

Never write all tests before all implementation, and never anticipate later slices. Refactor only while green, then rerun the focused check.

A good test enters through the seam callers use, takes its expected value from a literal example or the spec, fails when the behavior is absent, and survives an internal refactor.

## 3. Prove sensitivity and finish

For every test you keep, apply its spec's sensitivity change, watch it fail, restore, watch it pass, and report both runs. Then run the complete checks the repository or spec names.

Complete when every approved claim has a green test with a recorded sensitivity check, and the full checks pass.
