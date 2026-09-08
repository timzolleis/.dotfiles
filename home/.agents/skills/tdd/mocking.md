# Test Doubles

Use this reference when a tracer bullet needs controlled dependencies. The nearest project instructions and `../coding-standards/TESTING_AND_VERIFICATION.md` remain authoritative.

Replace behavior only through an intentional production seam. Prefer the term that says what the double does:

- **Stub:** returns a configured success or typed failure.
- **Fake:** implements the dependency contract with simpler controlled behavior.
- **Recording fake:** exposes meaningful outcomes such as sent messages for assertions.
- **Representative dependency:** real database or runtime used when its semantics are the behavior.

Do not patch modules or spy on methods. A hidden dependency that requires patching is a design problem, not a testing convenience.

Choose the narrowest faithful double:

| Behavior under test | Dependency choice |
|---|---|
| Domain rule | no dependency |
| Service branch or effect order | stub or recording fake through the declared port |
| HTTP decoding and status mapping | service stub |
| SQL, constraints, transaction, cascade, or row decoding | representative test database |
| External vendor request mapping | fake client at the vendor adapter seam |
| Time, randomness, or IDs | controlled production service |

A double honors the declared contract, including typed failures. Keep setup literal and branch-free. If the fake needs endpoint switches, business rules, or a second model of production behavior, the seam is too broad or the representative dependency is required.
