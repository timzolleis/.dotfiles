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
| a policy that branches | table test, plain values |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | table test |
| a guarded write or a visibility `where` | the adapter against a real database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: transitions whose policies are already tested, use cases that only load → call → publish, controllers, schemas. The types prove them.
