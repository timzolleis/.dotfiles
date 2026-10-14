# Testing

A test is permanently maintained code. Every later change to the code it covers has to keep it green, read it, and update it. Add a test only for a plausible regression the types don't catch (state unions, exhaustive `Match`, required input fields), and only when that is worth its fixtures, fakes, or database. No test is a valid outcome.

A test makes one claim, at the lowest place that owns the rule, and fails when that rule is broken.

Usual places (defaults, not a checklist):

| Rule lives in | Test with |
|---|---|
| a policy that branches | table test, plain values |
| a translation (permissions → actor, domain error → HTTP error, visibility → `where`) | table test |
| a guarded write or a visibility `where` | the adapter against a real database |
| a boundary instant | `DateTime.makeUnsafe`; test at the boundary and 1 ms after |

Usually no test: transitions whose policies are already tested, use cases that only load → call → publish, controllers, schemas. The types prove them.
