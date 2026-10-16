---
name: ddd-opportunities
description: Find the next small effect-ddd migration PRs, starting at the legacy edges of modules already migrated.
disable-model-invocation: true
---

# DDD opportunities

Find the next migration slices and propose them as small PRs. The user picks one, and `effect-ddd` takes over the design. The repository `AGENTS.md` owns the facts: legacy shapes, the edge-marker format, and the tracker.

## Why the frontier

Each migrated module reaches legacy code through marked **edges**. Together, these edges form the **frontier**. Migrating the module behind an edge pays twice. It adds an effect-ddd module, and it deletes the bridge in the migrated one (marker, adapter, reused legacy error). A migration away from the frontier adds bridges and deletes none.

Because the bridges go through ports, no migration ever forces its neighbours to migrate. Adjacency is about payoff. Correctness does not depend on it. The ripple stops where code is cold: a module that nobody changes and that no migrated module calls stays legacy.

## Steps

1. **Map the frontier.** Migrated modules are features with `application/` and `infrastructure/`. Group the edge markers by issue, check the open sub-issues under each legacy-edges parent in Linear, and name the legacy module behind each edge.
   Complete when every open marker belongs to one edge and every edge names its legacy module.

2. **Size each candidate.** For each legacy module behind an edge, collect:
   - use cases, in domain words, from its endpoints and service methods;
   - whether its core type has states;
   - its callers: other modules, subscribers, UI collections;
   - churn: `git log --since=6.months --oneline -- <paths> | wc -l`;
   - the markers it would retire.
   Complete when every candidate has all five.

3. **Cut slices.**
   - **Whole module** when it has few use cases, no lifecycle and few callers, for example a settings read plus update, or a list of reasons.
   - **Use case by use case** when it has a lifecycle, many use cases or many callers. The first PR is a tracer bullet: model, repository, views and one use case end-to-end. Each later PR moves one use case, its endpoint and its client caller.
   - **Read side alone** when many modules read it and few write it.

   Every slice preserves behavior. A legacy gap or bug becomes its own issue and is never a new policy. A slice migrates its callers and deletes the legacy path in the same PR (`principle-migrate-callers-then-delete-legacy-apis`). The absences pilot (78 files, +3.6k/−2.5k) is the upper bound, not the target.
   Complete when every slice names the use cases it moves, the legacy files it deletes, the markers it retires and the new edges it opens.

4. **Propose.** Rank slices by markers retired and churn first, then by smallest diff. Show at most 5 in one table and recommend one. Stop for the user's pick.

5. **Record the pick.** Create a Linear issue for the slice and mark it related to the edge issues it resolves. Then write the spec with `effect-ddd` ([spec.md](../effect-ddd/spec.md)).
   Complete when the issue exists and the spec draft is ready for the user's review.
