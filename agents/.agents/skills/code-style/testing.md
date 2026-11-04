# Testing

A test is permanently maintained code. Every later change to the code it covers has to keep it green, read it, and update it. Add one only when it earns that cost; adding no test is a valid outcome.

Before adding a test, answer:

1. Which plausible regression gets through without it?
2. Why don't the types already catch it? When the answer is "the types", break the code once and watch the type check fail.
3. What does it cost to keep? (fixtures, fakes, a real database)

A test makes one claim, at the lowest place that owns the rule. Before keeping it, break the rule and watch the test fail. What it asserts follows [test-behavior-not-implementation](~/.agents/skills/principle-test-behavior-not-implementation/SKILL.md).

- The title is a plain sentence about the behavior: "refuses an editor without permission to delete others' absences (rule 2)". No `→`, no positional `it.each` tuples with `$0` placeholders.
- Actors are named by their role (`creator`, `editor`, `member`), not by a person.
- A test file gets a helper only when several tests share it. A projection one test uses (`reportOf`, `guardianSlotsOf`) stays inline in its `expect`.
