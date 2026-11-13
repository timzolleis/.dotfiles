# Testing

In an Effect module the types prove most states and errors; check before you add a test: a pipeable `Effect.tapErrorTag` accepts any tag, a pipeable `Effect.catchTag` doesn't.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a rule that branches | one `it` per story example row: the transition, then `evolve`, asserted on the state or the error tag; plain values, no database |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | one `it` per case |
| the repository's writes or a visibility `where` | the adapter against a real database: a stale insert, a stale update, a stale delete, and nothing else for the writes |
| a use case that does more than find → decide → evolve → save → publish (a second transition, a conditional publish, two events) | one `it` on `layerNoDeps` with `Layer.mock` ports, asserting the writes and the exact list of published events; no database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: single rules apart from their transition, use cases that only find → decide → evolve → save → publish, controllers, schemas. The types prove them, except a missing publish line: that is found in review, where the call tree shows it as the last branch ([use-cases.md](use-cases.md#service)).

## Setup

A transition test: one `it` per example row of the story, named after the row's situation and outcome, with the row's values. Decide, then evolve, then assert on the state; a refusal asserts on the error tag. No database: the test proves what the user reviewed.

A fixture is the events that lead to its state, folded through `initialAbsence` and `evolveAbsence`; never a state written by hand. A test then can't start from a state the domain can't reach, and every fixture runs `evolve`.

```ts
// test/absence-fixtures.ts
const absenceAfter = (creation: AbsenceCreationEvent, ...changes: ReadonlyArray<AbsenceChangeEvent>): Absence =>
  changes.reduce((absence, event) => evolveAbsence({ absence, event }), initialAbsence(creation))

export const makeActiveAbsence = ({ creatorId = aliceId, period = octoberWeek, activatedOn = october1st } = {}): ActiveAbsence => {
  const absence = absenceAfter(makeDraftedEvent({ creatorId, period }), makeActivatedEvent({ occurredOn: activatedOn }))
  assert(absence._tag === "ActiveAbsence")
  return absence
}
```

```ts
// test/absence.test.ts
const alice = makeActor({ userId: aliceId })
const absence = makeActiveAbsence({ creatorId: aliceId, period: octoberWeek })

describe("archiveAbsence", () => {
  it("archive after the last day → AbsenceArchivedEvent", () => {
    const event = Result.getOrThrow(archiveAbsence({ absence, actor: alice, now: DateTime.makeUnsafe("2026-10-17T00:00:00Z") }))
    assert.strictEqual(evolveAbsence({ absence, event })._tag, "ArchivedAbsence")
  })

  it("archive on the last day → AbsenceOngoingError", () => {
    const result = archiveAbsence({ absence, actor: alice, now: DateTime.makeUnsafe("2026-10-16T23:59:00Z") })
    assert.strictEqual(Result.isFailure(result) ? result.failure._tag : "ok", "AbsenceOngoingError")
  })
})
```

An adapter against a real database: the adapter's layer on a real Prisma client, the host's ports faked in memory and reset per test.

```ts
// test/prisma-absence-repository.test.ts
const TestLayer = PrismaAbsenceRepository.layer.pipe(Layer.provide([PrismaLayer, HostLayer]))

layer(TestLayer)("PrismaAbsenceRepository", (it) => {
  it.effect("fails with ChangedConcurrently when the row changed after the find", () => Effect.gen(function* () {
    yield* reset
    const absence = yield* insertAbsenceRow(makeActiveAbsence({ activatedOn: DateTime.makeUnsafe("2026-10-01T00:00:00Z") }))
    const before = { ...absence, updatedAt: DateTime.makeUnsafe("2026-09-30T00:00:00Z") }
    const event = archivedEvent(absence)
    const absenceRepository = yield* AbsenceRepository
    expect(yield* outcome(absenceRepository.updateAbsence({ before, after: evolveAbsence({ absence: before, event }) }))).toBe("AbsenceChangedConcurrentlyError")
  }))
})
```

`reset` clears the table and the fakes; `insertAbsenceRow` writes a state's row directly with Prisma; `outcome` turns the exit into `"ok"`, `"die"`, or the error's tag. The writes have three tests, one each, and they never change: a new event or state is proven by its decide → evolve test and the exhaustive `absenceRowFromState`.

A use case with more than the five steps: its `layerNoDeps` with the ports mocked by `Layer.mock`, which implements only the methods the test names; any other call dies. No database: only a test of database behavior (the guard, a `where`) needs one. The exact lists fail on a missing write or publish and on one nobody expected. The shape, shown on `archiveAbsence`, which alone would need no test:

```ts
// test/archive-absence-service.test.ts
it.effect("stores the archived absence and publishes exactly AbsenceArchivedEvent", () => {
  const absence = makeActiveAbsence({ creatorId: aliceId, period: octoberWeek })
  const updates: Array<UpdateAbsenceInput> = []
  const publishedEvents: Array<DomainEvent> = []
  const TestLayer = ArchiveAbsenceService.layerNoDeps.pipe(Layer.provide([
    Layer.mock(AbsenceRepository, {
      findActiveAbsenceById: () => Effect.succeed(absence),
      updateAbsence: (input) => Effect.sync(() => { updates.push(input) }),
    }),
    Layer.mock(DomainEvents, { publishDomainEvent: (event) => Effect.sync(() => { publishedEvents.push(event) }) }),
  ]))

  return Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-17T00:00:00Z")))
    const archiveAbsenceService = yield* ArchiveAbsenceService
    yield* archiveAbsenceService.archiveAbsence({ organizationId: absence.organizationId, actor: alice, absenceId: absence.absenceId })
    assert.deepStrictEqual(updates.map(({ before, after }) => [before, after._tag]), [[absence, "ArchivedAbsence"]])
    assert.deepStrictEqual(publishedEvents.map((event) => event._tag), ["AbsenceArchivedEvent"])
  }).pipe(Effect.provide(TestLayer))
})
```

`it.effect` runs on `TestClock`: `DateTime.now` starts at 1970-01-01, so "today" is too. A fixture that depends on the date sets the clock (`TestClock.setTime`) or carries no date.
