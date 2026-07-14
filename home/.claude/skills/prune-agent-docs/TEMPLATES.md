# Templates

Skeletons and portable rule text. Adapt names/paths to the target repo; every claim you fill in must be verified against that repo (Phase 1), not copied from another project.

## Tier-1 CLAUDE.md skeleton

```markdown
# <repo-name>

<2–3 lines: what the app is, the load-bearing stack — only names that affect how code is written.>

<Delegation line: which global tiers own the generic standards (global CLAUDE.md, coding-standards
skill), and that this file only adds repo specifics. State the conflict rule: more specific wins.>

## Commands
<Only verified scripts. Mark the dangerous ones (dev servers agents must not start). Keep the
repo's hard gates (e.g. "typecheck after every change") — they're load-bearing discipline.>

## Structure
<Short tree of the real layout: apps, packages, where features/tests/fixtures live.>

## Architecture
<One-directional flow in a sentence, then the layer-ownership table — the single most orienting
artifact. The "must not" column is the enforcement teeth:>

| Layer | Owns | Must not |
|---|---|---|
| Model | invariants, transitions | persistence, side effects |
| Repository | queries, row↔model mapping, typed errors | publish events, business decisions |
| Service | orchestration, publishing after save | HTTP concerns |
| Router | wire schemas, auth, error mapping | business logic, direct repo calls |

<Plus any always-relevant splits agents confuse (e.g. "two event systems, not interchangeable").>

## Keeping code clean — altitude rules
<See below; tune one rule per failure mode actually observed in this repo.>

## Conventions (new and refactored code)
<The repo's mandatory conventions, incl. every deliberate deviation from the global standards,
each marked "deliberately overrides X — do not correct it back".>

## Pattern index
<One line per pattern doc: name — what it covers. Reference implementation named where one exists.>

## Testing
<~5 lines: framework choice, fixture locations, DB/test-layer names — then a pointer to the
testing doc. No examples here.>
```

## Altitude rules (portable text)

The anti-slop core. Keep the framing sentence — it tells the agent *why* these exist:

```markdown
## Keeping code clean — altitude rules

These exist because the failure mode of generated code here is not "wrong" but "spaghetti":
redeclared shapes, dead helpers, logic in the wrong layer.

- **Search before declaring.** The model, schema, error, or helper you are about to write probably
  exists — in <domain package>, the feature's <schema/error dirs>, or <shared lib>. Never redeclare
  a shape that exists; **derive** it (<schema pick/omit/extend, `typeof X.Type`,
  `Parameters<typeof fn>`>) instead of writing a parallel copy that will drift.
- **Domain models are the working currency.** If you are threading three loose fields between
  functions that all describe the same entity, pass the model. Field-bag parameters and ad-hoc
  `{ id, name, … }` interfaces are the spaghetti seed.
- **Don't extract single-use helpers.** Extract when a second caller exists or the name states a
  real domain concept. Five inline lines the reader can see beat a helper that hides them —
  indirection is a cost, not cleanliness.
- **Put logic where the table says it lives.** A branch on domain state in a router, an event
  publish in a repository, a <persistence> call in a service — each is a misplacement, not a style
  choice.
- **Smallest correct change.** No speculative adapters, options, generics, or "will need it later"
  seams. A seam is real only when a second implementation (a test fixture counts) exists or is
  concretely planned.
```

Add repo-specific rules only for failure modes actually observed; five is the sweet spot — a list
of fifteen is how the docs got bloated in the first place.

## Tier-2 pattern-doc skeleton

```markdown
# <Pattern Name>

<2–3 lines: what it is and the guarantee it buys.>

**Reference implementation: `<feature>`** — <the real files>. Read it before writing a new one.

## When to use it — and when not to
<Both halves mandatory. The "not" half grants permission to skip layers: the maximal shape is the
exception, not the default.>

## Non-negotiables
<The contracts that cause real bugs when violated. Each one earns its place; no restating what the
global standards or other pattern docs own — link instead.>

## <2–4 mechanism sections>
<Condensed examples FROM the reference implementation. Rules as bullets under each example.
State facts about the machinery that can't be seen from one file (delivery guarantees, retry
policies, registration points whose omission fails silently).>

## Traps / Anti-patterns
<The earned knowledge — keep sharp and concrete. Table form works: Bad | Good.>
```

## Style rules for the rewrite

- No "Status in this codebase" sections and no "(to build)" specs — both go stale fastest. Describe
  what exists; an unbuilt direction gets ≤3 lines ("v2 direction, only if needed: …").
- No provenance narration ("ported from X", "replaces the old Y") — git knows.
- Every code identifier mentioned must exist in the repo (grep-verified).
- Every dead link is a bug; every example is condensed from real code, not invented.
- Known gaps get stated plainly in the doc ("sweeps don't exist yet — every reconciler needs one")
  AND reported to the user — never papered over.
