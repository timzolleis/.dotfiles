# Behavior Tests

Use this reference when a tracer-bullet test is hard to distinguish from an implementation test. The nearest project instructions and `../coding-standards/TESTING_AND_VERIFICATION.md` remain authoritative.

## Keep

A useful test:

- enters through the public seam used by callers;
- names one observable behavior;
- uses an expected value from a literal example, worked rule, or approved spec;
- fails when that behavior is absent;
- survives an internal refactor;
- sits in the layer that owns the decision.

```ts
it("returns the worked invoice total", () => {
  expect(calculateInvoiceTotal([{ cents: 1_000 }, { cents: 500 }])).toBe(1_500)
})
```

## Reject

Reject a test when it:

- calls a private helper;
- asserts internal call counts or incidental ordering;
- recomputes the expected value with the production algorithm;
- proves a dependency's documented behavior;
- queries a side channel when the public interface exposes the result;
- repeats a decision already tested by its owning layer.

```ts
it("calculates the total", () => {
  const lines = [{ cents: 1_000 }, { cents: 500 }]
  const expected = lines.reduce((sum, line) => sum + line.cents, 0)
  expect(calculateInvoiceTotal(lines)).toBe(expected)
})
```

The second test is tautological. The expected value can drift with the same mistake as the implementation.
