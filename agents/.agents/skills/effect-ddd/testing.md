# Testing

In an Effect module the types prove most states and errors; check before you add a test: a pipeable `Effect.tapErrorTag` accepts any tag, a pipeable `Effect.catchTag` doesn't.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a rule that branches | one `it` per story example row: `Absence.decide`, then `Absence.evolve`, asserted on the state or the error tag; plain values, no database |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | one `it` per case |
| the repository's writes or a visibility `where` | the adapter against a real database: a stale insert, a stale update, the purge, and nothing else for the writes |
| a use case that does more than find → decide → evolve → save → publish (a second command, a conditional publish, two events) | one `it` on `layerNoDeps` with `Layer.mock` ports, asserting the writes and the exact list of published events; no database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: single rules apart from their decide, the lib's `Aggregate.make` (the reference repo tests it), use cases that only find → decide → evolve → save → publish, controllers, schemas. The types prove them, except a missing publish line: that is found in review, where the call tree shows it as the last branch ([use-cases.md](use-cases.md#service)).

## Setup

A decide test: one `it` per example row of the story, named after the row's situation and outcome, with the row's values. Decide, then evolve, then assert on the state; a refusal asserts on the error tag. No database: the test proves what the user reviewed.

A fixture is the events that lead to its state, folded through `Absence.evolve`; never a state written by hand. A test then can't start from a state the domain can't reach, and every fixture runs `evolve`. `evolve`'s result follows the state, so a fixture needs no tag check.

```ts
// test/support.ts
export const makeActiveAbsence = ({ activatedOn = at("2026-02-01T10:05:00Z"), ...input }: AbsenceFixtureInput & { readonly activatedOn?: DateTime.Utc } = {}): ActiveAbsence => {
  const drafted = makeDraftedEvent(input)
  return Absence.evolve({ absence: Absence.evolve({ event: drafted }), event: makeActivatedEvent(drafted, activatedOn) })
}
```

```ts
// test/absence-aggregate.test.ts
  it("archives an active absence whose period has ended, and keeps its activatedAt", () => {
    const event = Result.getOrThrow(Absence.decide({
      absence: activeAbsenceOfAlice, command: ArchiveAbsenceCommand.make({ actor: actorAlice }), now: afterPeriod,
    }))
    const absenceAfterArchive = Absence.evolve({ absence: activeAbsenceOfAlice, event })
    expect(absenceAfterArchive).toMatchObject({
      _tag: "ArchivedAbsence", absenceId: activeAbsenceOfAlice.absenceId, period: activeAbsenceOfAlice.period,
      activatedAt: activeAbsenceOfAlice.activatedAt, archivedAt: afterPeriod, updatedAt: afterPeriod,
    })
  })

  it("refuses to archive while the period is ongoing", () => {
    const decision = Absence.decide({
      absence: activeAbsenceOfAlice, command: ArchiveAbsenceCommand.make({ actor: actorAlice }), now: at("2026-03-01T12:00:00Z"),
    })
    expect(Result.getFailure(decision)).toMatchObject({ value: { _tag: "AbsenceOngoingError", absenceId: activeAbsenceOfAlice.absenceId } })
  })
```

An adapter against a real database: the adapter's layer on a real Prisma client, the host's ports faked in memory and reset per test.

```ts
// test/prisma-absence-repository.test.ts
const TestLayer = PrismaAbsenceRepository.layer.pipe(Layer.provide([PrismaLayer, HostLayer]))

layer(TestLayer)("PrismaAbsenceRepository", (it) => {
  it.effect("fails with ChangedConcurrently when the row changed after the find", () => Effect.gen(function* () {
    yield* reset
    const absence = yield* insertAbsenceRow(makeActiveAbsence({ activatedOn: at("2026-02-01T10:05:00Z") }))
    const before = { ...absence, updatedAt: at("2026-02-01T10:00:00Z") }
    const event = archivedEvent(absence)
    const absenceRepository = yield* AbsenceRepository
    expect(yield* outcome(absenceRepository.updateAbsence({ before, after: Absence.evolve({ absence: before, event }) }))).toBe("AbsenceChangedConcurrentlyError")
  }))
})
```

`reset` clears the table and the fakes; `insertAbsenceRow` writes a state's row directly with Prisma; `outcome` turns the exit into `"ok"`, `"die"`, or the error's tag. The writes have one test each, and they never change: a new event or state is proven by its decide → evolve test and the exhaustive `absenceRowFromState`.

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
