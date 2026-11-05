# Testing

In an Effect module the types prove most states and errors; check before you add a test: a pipeable `Effect.tapErrorTag` accepts any tag, a pipeable `Effect.catchTag` doesn't.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a rule that branches | one `it` per story example row: the transition, then `evolve`, asserted on the state or the error tag; plain values, no database |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | one `it` per case |
| the repository's save or a visibility `where` | the adapter against a real database: a stale insert, a stale update, a stale delete, and nothing else for the save |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: single rules apart from their transition, use cases that only load → call → publish, controllers, schemas. The types prove them.

## Setup

A transition test: one `it` per example row of the story's rule block, named exactly as the row's Test cell (`situation (rule n) → outcome`), with the row's values. Decide, then evolve, then assert on the state; a refusal asserts on the error tag. No database: the test proves what the user reviewed, and the story check finds it by name ([story.md](story.md#checking-a-story)).

```ts
// test/absence.test.ts
const alice = makeActor({ userId: aliceId })
const absence = makeActiveAbsence({ creatorId: aliceId, period: octoberWeek })

describe("archiveAbsence", () => {
  it("archive after the last day (rule 4) → AbsenceArchivedEvent", () => {
    const event = Result.getOrThrow(archiveAbsence({ absence, actor: alice, now: DateTime.makeUnsafe("2026-10-17T00:00:00Z") }))
    const archived = evolveAbsence({ absence: Option.some(absence), event })
    assert.deepStrictEqual(Option.map(archived, (absence) => absence._tag), Option.some("ArchivedAbsence"))
  })

  it("archive on the last day (rule 4) → AbsenceOngoingError", () => {
    const result = archiveAbsence({ absence, actor: alice, now: DateTime.makeUnsafe("2026-10-16T23:59:00Z") })
    assert.strictEqual(Result.isFailure(result) ? result.failure._tag : "ok", "AbsenceOngoingError")
  })
})
```

An adapter against a real database: the adapter's layer on a real Prisma client, the host's ports faked in memory and reset per test.

```ts
// test/prisma-absence-repository.test.ts
const TestLayer = PrismaAbsenceRepository.pipe(Layer.provide([PrismaLayer, HostLayer]))

layer(TestLayer)("PrismaAbsenceRepository", (it) => {
  it.effect("fails with ChangedConcurrently and publishes nothing when the row changed after the find", () => Effect.gen(function* () {
    yield* reset
    const absence = yield* insertAbsenceRow(makeActiveAbsence({ updatedAt: DateTime.makeUnsafe("2026-10-01T00:00:00Z") }))
    const before = Option.some({ ...absence, updatedAt: DateTime.makeUnsafe("2026-09-30T00:00:00Z") })
    const event = archivedEvent(absence)
    const absenceRepository = yield* AbsenceRepository
    expect(yield* outcome(absenceRepository.saveAbsence({ event, before, after: evolveAbsence({ absence: before, event }) }))).toBe("AbsenceChangedConcurrentlyError")
    expect(host.publishedEvents).toHaveLength(0)
  }))
})
```

`reset` clears the table and the fakes; `insertAbsenceRow` writes a state's row directly with Prisma; `outcome` turns the exit into `"ok"`, `"die"`, or the error's tag. The save has three tests, one per write, and they never change: a new event or state is proven by its decide → evolve test and the exhaustive `absenceRowFromState`.

`it.effect` runs on `TestClock`: `DateTime.now` starts at 1970-01-01, so "today" is too. A fixture that depends on the date sets the clock (`TestClock.setTime`) or carries no date.
