# Testing

**A test is permanently maintained code.** Every future change to the code it touches carries it: it is read, kept green, updated when behavior moves, and debugged when it flakes. A test must justify that lifetime cost the way a module justifies its interface. Adding no test is a valid outcome.

## The six admission questions

Every permanent test answers all six:

1. What plausible regression escapes without this test?
2. What single confidence claim does it buy?
3. Which module and seam own that decision?
4. Why do types, static checks, existing tests, or manual verification leave a material evidence gap?
5. What fixtures, fakes, runtime, and coupling must maintainers carry?
6. What temporary implementation change proves the test is sensitive to the claimed regression?

## Where each decision is tested

| Module kind | Test | Only when | Rig |
|---|---|---|---|
| Policy | table test, inputs → outputs | it branches or computes | plain values, no Effect |
| Repository | real database | it owns a persistence guarantee: a visibility predicate, a race guard, a level-3 decode transform | the repo's real test database Layer |
| Service | orchestration | a branch chooses different effects, or effect order matters | `Layer.mock` for repositories and clients |
| HTTP edge | codec | a level-3 transform or a `*HttpError` status and body | encode with the codec, no server |
| Handler, states, field codecs | none | — | types and `tsc` prove them |

Prove each claim at the lowest seam that owns it, once. A heavier rig does not buy broader confidence.

## Rules

- **One test, one confidence claim.** Delete every assertion whose removal would not weaken the claim: inputs, configured fake returns, incidental fixture fields, and type guarantees are known before the call.
- **Tests are decided in the spec**, in the module section they cover (below its call tree when it has one), as a defense. Plannotator approval of the spec approves the test and its cost. Add no test that the spec does not name.
- **Prove sensitivity before keeping a test**: introduce the claimed regression, watch the test fail for that reason, restore, watch it pass. Report both runs.
- **Replace, don't layer.** When a module deepens, tests at its new interface replace the old tests on the shallow parts.
- **Control time, randomness, and IDs** through Effect services (`TestClock`, seeded values); never let them decide an outcome.
- **No module mocks or spies.** Replace behavior at a seam with a Layer.
- Temporary diagnostic tests are exempt only when deleted before the work is done.
- Use `@effect/vitest` (`it.effect`, `assert`) for Effect code and plain Vitest for pure functions, unless the repository says otherwise.

## Test doubles

Name a double for what it does, and use the narrowest faithful one:

- **Stub:** returns a configured success or typed failure (`Layer.mock`).
- **Fake:** implements the contract with simpler controlled behavior.
- **Recording fake:** exposes meaningful outcomes, such as sent messages, for assertions.
- **Representative dependency:** the real database or runtime, when its semantics are the behavior.

## A test in the spec

```text
AnnouncementRepository.publishAnnouncement rejects an already-published row      [repository · real database]
  regression   the `status: 'draft'` guard is dropped → double publish, two events
  gap          types cannot see the where clause; service tests use Layer.mock
  burden       one seeded draft row; changes only if the transition changes
  sensitivity  remove `status: 'draft'` from the where → test fails
```

The heading line carries the claim and the seam; the four labels answer the remaining questions.
