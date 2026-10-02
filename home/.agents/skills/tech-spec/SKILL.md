---
name: tech-spec
description: Write the spec for a design locked in conversation, as typed contracts, call trees, and slices. Use when every open decision is locked and the change is too large for one context, or when the user asks for a spec.
---

# Tech Spec

A spec is the record of what we locked while pairing (`AGENTS.md`, How we work), written so a fresh context can implement it without the conversation. It is code-shaped: TypeScript pseudocode for contracts, call trees for behavior, prose only for the why.

The spec adds no design of its own. Writing it down often exposes a gap: a contract nobody discussed, a failure with no owner, a slice that cannot stand alone. When that happens, stop and raise it the way we raise any decision — one recommendation, its trade-off, "Agree?" — then continue once it is locked. If the conversation never settled the shape at all, go back to pairing instead of writing.

## Getting the facts right

The locked decisions give the shape; the codebase gives the details. Before writing a contract, check the local precedent it should follow — naming, module layout, error style, test style — and the repository's own instructions, which win. Verify unfamiliar library APIs against the source the repository names. For a standards question the repository does not answer, read only the matching topic in `../coding-standards/`.

## What goes in

Give each kind of information one home, and point to it instead of repeating it:

- **Seam sections** own contracts: domain values and states, inputs, outputs, typed errors, boundary schemas, and layer requirements a caller must satisfy. Leave out private helpers, example data, and bodies, unless effect order, a transaction, or layer composition cannot be read from the signature.
- **Call paths** own behavior: one call tree per materially different operation, from entrypoint to result or typed failure, with authorization, parsing, transactions, and other correctness-critical effects inline.
- **Slices** own order, files, and evidence. Add them only when one context cannot hold the whole spec. Cut them from call paths so each leaves the app working: a slice completes one or more call paths end to end, or establishes one named invariant through the seam that owns it. Evidence follows the test admission rule in `AGENTS.md` — often existing tests or typechecking, sometimes a named manual check.
- **Trade-offs** record what we chose over what, and the cost, for each decision a future reader might second-guess. This includes defaults the agent picked and reported rather than asked about.

Name what the change deletes; a spec that replaces a shape says what disappears. Leave out repository defaults, routine conventions, and standard check commands.

## Outline

```md
# <Title>

The caller-visible change, where it stops, and any constraint not visible below.

## 1. <Seam name>

Typed contract. Semantics the types cannot express, as a short list.

## 2. <Next seam>
...

## Call paths

One call tree per operation (format in `AGENTS.md`).

## Slices  (omit when one context holds the whole spec)

- [ ] 1. <name> — completes: <call path> | establishes: <invariant> (§n)
  - Files: <paths to add/change/delete>
  - Prove: <evidence>

## Trade-offs

- <chosen> over <alternative> — <cost>
```

## Handing it over

Save the spec to repository-root `plans/<descriptive-kebab-case>.md` (or the filename the user gave), then call `enter_plan_mode` and submit it with `plannotator_submit_plan`. Review should read as confirmation of what we agreed; if it returns changes, update the same file and resubmit. After approval, implementation happens through `/implement <spec-path> [slice]` in a fresh context — do not start it here.
