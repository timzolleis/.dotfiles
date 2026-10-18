# Testing

A test is permanently maintained code. Every later change to the code it covers has to keep it green, read it, and update it. Add one only when it earns that cost; adding no test is a valid outcome.

Before adding a test, answer:

1. Which plausible regression gets through without it?
2. Why don't the types already catch it? (state unions, exhaustive `Match`, required input fields)
3. What does it cost to keep? (fixtures, fakes, a real database)

A test makes one claim, at the lowest place that owns the rule. Before keeping it, break the rule and watch the test fail.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a rule that branches | table test, plain values |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | table test |
| a guarded write or a visibility `where` | the adapter against a real database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: transitions whose rules are already tested, use cases that only load → call → publish, controllers, schemas. The types prove them.

## Setup

A rule table: plain values, one row per case.

```ts
// test/absence-rule.test.ts
const failureTag = (result: Result.Result<unknown, { readonly _tag: string }>) =>
  Result.isFailure(result) ? result.failure._tag : "ok"

describe("actor rules: own / others' draft / others' active × flag", () => {
  const draftOfAlice = makeDraftAbsence({ creatorId: alice })
  const activeOfAlice = makeActiveAbsence({ creatorId: alice })
  const cases = [
    { absence: draftOfAlice, actor: makeActor({ userId: alice }), edit: "ok", delete: "ok" },
    { absence: activeOfAlice, actor: makeActor({ userId: bob, mayEditOthersAbsences: true }), edit: "ok", delete: "NotAllowedToDeleteAbsenceError" },
    // …one row per actor × state × flag
  ]
  it.each(cases)("$absence._tag by $actor.userId → edit $edit, delete $delete", ({ absence, actor, ...expected }) => {
    expect(failureTag(onlyCreatorOrPermittedCanEditRule({ absence, actor }))).toBe(expected.edit)
    expect(failureTag(onlyCreatorOrPermittedCanDeleteRule({ absence, actor }))).toBe(expected.delete)
  })
})
```

An adapter against a real database: the adapter's layer on a real Prisma client, the host's ports faked in memory and reset per test.

```ts
// test/prisma-absence-repository.test.ts
const TestLayer = PrismaAbsenceRepository.pipe(Layer.provide([PrismaLayer, HostLayer]))

layer(TestLayer)("PrismaAbsenceRepository", (it) => {
  it.effect("archive a row that is no longer active → AbsenceChangedConcurrentlyError, nothing published", () => Effect.gen(function* () {
    yield* reset
    const absenceId = yield* insertAbsenceRow("draft")
    const absenceRepository = yield* AbsenceRepository
    expect(yield* outcome(absenceRepository.publishAbsenceEvent(archivedEvent(absenceId)))).toBe("AbsenceChangedConcurrentlyError")
    expect(host.publishedEvents).toHaveLength(0)
  }))
})
```

`reset` clears the table and the fakes; `insertAbsenceRow` writes a row directly with Prisma; `outcome` turns the exit into `"ok"`, `"die"`, or the error's tag.
