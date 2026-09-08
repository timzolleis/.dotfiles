---
name: design-first
description: Design interfaces, call paths, seams, adapters, and errors with the user before implementation.
disable-model-invocation: true
---

# Design First

Produce an agreed, concise interface spec before implementation. When the design turns out wrong, return to the spec instead of polishing the wrong implementation.

## 1. Establish the facts

Read the nearest instructions, domain context, architecture decisions, and the most recent comparable module. Trace one operation from ingress through every decision and effect to its result or failure.

Classify each changed concern by what makes it change:

- business meaning or invariant → domain;
- application policy, authorization, or effect order → service;
- protocol, framework, database, or vendor API → adapter;
- construction only → composition root.

Find environmental facts yourself. Ask the user only for requirements and trade-offs.

## 2. Draft the interface spec

Give a concise view of the feature, then lead with TypeScript pseudocode rather than prose:

1. domain types and invariants at each seam;
2. public service or module interfaces;
3. typed expected errors in every method channel;
4. representative call sites;
5. production and test composition when they differ materially;
6. call stacks for each materially different operation;
7. constraints that shape the architecture;
8. viable alternatives evaluated and why the selected design wins.

Use signatures and structural pseudocode rather than implementation bodies. Include a short body only when effect order, compensation, or another architectural choice cannot be understood from the contract.

Apply the deletion test to every proposed service, wrapper, and helper. Reuse an existing owner before adding another. For a contested design, show materially different alternatives and recommend the deepest interface that is hardest to misuse.

## 3. Grill the design

Read `/Users/tim/.agents/skills/grilling/SKILL.md` completely and use its design-tree and frontier-round process for unresolved decisions.

When feedback changes the design, show the complete current spec so the user does not need to merge versions mentally. Invite line-anchored Plannotator annotations for a substantial spec.

## 4. Lock and record

The design is ready when:

- the frontier is empty;
- the feature, types, boundaries, typed failures, composition, call paths, constraints, and evaluated decisions are explicit;
- every proposed seam and abstraction passes the reuse and deletion checks;
- the user approves the current spec.

Before recording the design, read and apply [`PLAN-FORMAT.md`](./PLAN-FORMAT.md). Preserve the approved types, interfaces, composition, boundaries, call stacks, constraints, and evaluated decisions. Do not reduce the design to prose.

Write the plan to `plans/<kebab-case-name>.md` and submit it through Plannotator when the task needs a durable working plan. Plan mode records the agreed design; it is not another design-approval ceremony.

Implementation starts only from the approved spec or a selected named todo. Use `tdd` at the agreed seams.
