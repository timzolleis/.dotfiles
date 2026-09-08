# Plan format

Plans are concise, local working documents. They explain a feature and its architecture well enough that a reader can implement or review it without reconstructing the design discussion.

Use only the applicable sections below. Omit empty sections and routine details.

## Feature

Give a short orientation:

- what changes for the user or caller;
- the concrete behavior that becomes possible;
- the boundary of the feature;
- non-goals only when they prevent a likely misunderstanding.

Prefer a small before/after table or concrete scenarios over requirements prose.

## Architecture

Lead with TypeScript pseudocode. Show the domain types, interfaces, expected errors, composition, and boundaries that define the design.

```ts
type FeatureState =
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Completed"; readonly completedAt: DateTime.Utc }

interface FeatureService {
  readonly complete: (
    command: CompleteFeatureCommand,
  ) => Effect<CompletedFeature, FeatureNotReadyError | FeatureWriteError>
}

interface FeatureRepository {
  readonly saveCompleted: (
    feature: CompletedFeature,
  ) => Effect<void, FeatureWriteError>
}
```

Show how the pieces compose when wiring is part of the design:

```ts
const featureLayer: Layer<
  FeatureService,
  never,
  FeatureRepository | Clock
>
```

Include:

- important domain states and invariants;
- caller-facing capabilities;
- ownership and dependency boundaries;
- typed expected failures;
- representative call sites;
- production and test composition when they differ materially.

Use signatures and structural pseudocode rather than implementation bodies. Include a short body only when effect order, compensation, or another architectural decision cannot be understood from the contract.

## Call paths

Show one call stack for each materially different operation. Group operations that cross the same boundaries.

```text
POST /features/:id/complete
→ feature policy: authorize the caller
→ FeatureService.complete
  → featureCanComplete: validate the domain transition
  → FeatureRepository.saveCompleted
    → database update: scoped write
→ CompleteFeatureResponse
```

Add an important failure path only when it explains architecture or effect order:

```text
FeatureRepository.saveCompleted
→ FeatureWriteError
→ no completion event is published
→ router returns a retryable failure
```

Name the role of each node. A reader should see where a decision is made, where an effect occurs, and how success or failure reaches the caller.

## Constraints and decisions

Record constraints that shape the architecture:

| Constraint | Design consequence |
|---|---|
| Every write is tenant-scoped | Tenant identity reaches the repository boundary |
| The request cannot wait for a vendor call | Vendor work starts after the persisted event |

Record only viable alternatives that were evaluated:

| Decision | Selected | Rejected | Why |
|---|---|---|---|
| Follow-up work | Event subscriber | Vendor call inside the request | Keeps external availability outside write success |

Keep domain, security, data, operational, and compatibility constraints only when they affect the design. Do not preserve the full research log.


## Delivery

Keep implementation guidance compact:

- affected areas or key files;
- migration, rollout, or compatibility work when applicable;
- the behavior that proves the feature works;
- verification commands.

Do not add exhaustive symbol maps, routine reuse probes, deletion-test notes, test inventories, or every possible failure. Those belong in design, implementation, and review work unless they explain an architectural choice.

## Completion

A plan is ready when the reader can quickly explain:

1. what the feature does;
2. which types and boundaries define it;
3. how the parts compose;
4. how each important operation flows;
5. which constraints shaped the design;
6. which alternatives were evaluated and why the selected design won;
7. how completion will be proven.

Resolve design questions before approval. Do not use an open-decisions section as a substitute for finishing the design.
