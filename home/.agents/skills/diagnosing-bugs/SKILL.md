---
name: diagnosing-bugs
description: Evidence-first diagnosis for reported failures, regressions, flaky behavior, and performance problems.
---

# Diagnosing Bugs

Diagnose from evidence. Build a command that exposes the reported symptom, test a falsifiable cause, and keep the final regression test at the layer that owns the defect.

Read the nearest project instructions first. They own test seams, runtime tools, observability, privacy, and verification commands.

## 1. Pin the symptom

Record:

- what the user observes;
- what should happen instead;
- the smallest known input and environment;
- the first known good and bad states, when available.

Redact secrets and personal data before showing commands, output, traces, screenshots, or captured requests. Do not weaken the signal by publishing unsafe artifacts; ask for a safe substitute when needed.

Complete when the expected and observed outcomes are distinct and testable.

## 2. Build the feedback loop

Prefer the narrowest command that drives the real failing path:

1. focused existing test;
2. HTTP or CLI reproduction;
3. browser or runtime script;
4. replayed redacted fixture;
5. small throwaway harness;
6. repeated, differential, or bisect loop for flaky and regression cases.

Run it before editing. Assert the exact symptom, not only that the path throws or completes. Control time, randomness, IDs, network responses, and mutable state when they affect the verdict.

For intermittent bugs, increase the reproduction rate with repetition or controlled stress. For performance bugs, capture a baseline measurement before changing code.

If no agent-runnable loop is possible, state what blocks it and ask for the missing environment, a redacted artifact, or permission for targeted instrumentation.

Complete when one named command can show the defect or when the missing evidence is explicit.

## 3. Test a hypothesis

Use the evidence to state a falsifiable cause:

```text
If <cause> is responsible, then <one focused probe> will produce <predicted result>.
```

For a broad failure, rank a short set of plausible causes before probing. Change one variable at a time. Prefer debugger or direct state inspection over telemetry. When instrumentation is necessary, follow project conventions, use a unique searchable marker, and inspect automatic outer instrumentation for sensitive capture.

A failed prediction removes or lowers that hypothesis. It is not permission to make a speculative fix.

Complete when one probe identifies the cause or the remaining uncertainty is named.

## 4. Lock the defect and fix it

Put the regression test at the public seam owned by the faulty decision. The test must reproduce the real pattern and fail before the fix. If no correct seam exists, report that design gap instead of adding a shallow test that gives false confidence.

Apply the smallest fix that explains all observed evidence. Then run:

1. the regression test;
2. the original, unminimized feedback loop;
3. affected project checks.

After two failed fixes, stop. Report the observation, expected result, each attempted fix and what its result disproves, and the next useful check or user decision.

Complete when both the minimized regression and original symptom are green.

## 5. Clean up

Remove tagged instrumentation, throwaway harnesses, captured sensitive artifacts, and unrelated experiments. Keep only a useful regression test or an intentionally retained diagnostic tool with a clear owner.

Report the confirmed cause in plain words: name what failed and its user-visible effect.
