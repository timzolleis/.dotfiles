# Testing

In an Effect module the types prove most states and errors; check before you add a test: a pipeable `Effect.tapErrorTag` accepts any tag, a pipeable `Effect.catchTag` doesn't.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a rule that branches | one `it` per case, plain values |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | one `it` per case |
| a guarded write or a visibility `where` | the adapter against a real database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: transitions whose rules are already tested, use cases that only load → call → publish, controllers, schemas. The types prove them.

## Setup

A rule test: one named `it` per case, plain values, the cases taken from the story's examples so the user can check them ([use-cases.md](use-cases.md)).

```ts
// test/absence-rule.test.ts
const failureTag = (result: Result.Result<unknown, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : "ok"

const creator = makeActor({ userId: creatorId })
const editor = makeActor({ userId: editorId, mayEditOthersAbsences: true })

describe("onlyCreatorOrPermittedCanEditRule", () => {
  it("lets the creator edit their own draft", () => {
    expect(failureTag(onlyCreatorOrPermittedCanEditRule({ absence: makeDraftAbsence({ creatorId }), actor: creator }))).toBe("ok")
  })

  it("refuses an editor on someone else's draft", () => {
    expect(failureTag(onlyCreatorOrPermittedCanEditRule({ absence: makeDraftAbsence({ creatorId }), actor: editor }))).toBe("NotAllowedToEditAbsenceError")
  })
})
```

An adapter against a real database: the adapter's layer on a real Prisma client, the host's ports faked in memory and reset per test.

```ts
// test/prisma-absence-repository.test.ts
const TestLayer = PrismaAbsenceRepository.pipe(Layer.provide([PrismaLayer, HostLayer]))

layer(TestLayer)("PrismaAbsenceRepository", (it) => {
  it.effect("fails with ChangedConcurrently and publishes nothing when the row is no longer active", () => Effect.gen(function* () {
    yield* reset
    const absenceId = yield* insertAbsenceRow("draft")
    const absenceRepository = yield* AbsenceRepository
    expect(yield* outcome(absenceRepository.publishAbsenceEvent(archivedEvent(absenceId)))).toBe("AbsenceChangedConcurrentlyError")
    expect(host.publishedEvents).toHaveLength(0)
  }))
})
```

`reset` clears the table and the fakes; `insertAbsenceRow` writes a row directly with Prisma; `outcome` turns the exit into `"ok"`, `"die"`, or the error's tag.

`it.effect` runs on `TestClock`: `DateTime.now` starts at 1970-01-01, so "today" is too. A fixture that depends on the date sets the clock (`TestClock.setTime`) or carries no date.
