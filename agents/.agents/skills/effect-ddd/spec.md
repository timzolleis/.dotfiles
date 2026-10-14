# Spec

A spec is pseudocode in the shape of the module it designs: the record of locked decisions, reviewed with Plannotator annotations. Write it after the first decision locks, only what is locked, and rewrite a part in place when its decision changes.

Header: `Pseudocode spec. Not type-checked. Imports omitted.` List conventions only where they differ from effect-ddd.

Sections in this order; leave out a section the change doesn't touch:

| Section | Holds |
|---|---|
| Decisions | table: Topic \| Choice \| Source |
| Lifecycle and rules | state diagram; command × state table; who may act; who sees what; check order |
| Layout | file tree, one line per file |
| Model | ids, states, actor and reader, transition inputs, transitions, where rules live, policies |
| Events | table: Event \| Extra fields \| Emitted by |
| Domain errors | table: Error \| Fields \| Raised by |
| Ports | signatures |
| Reads | views port, view schema, visibility `where` |
| Use cases | one template, then a call tree per command |
| Repository | finds table, decoding, writes table |
| HTTP | middleware, permissions table, HTTP errors table, endpoints table, controller call trees |
| Wiring and tests | layer tree; the tests [testing.md](testing.md) admits |
| Open | accepted gaps only, numbered, one or two lines each |

- Tables and call trees over prose. Every name greps to its definition.
- Leave out what the host repository's infrastructure solves.
- Ports owned by other modules are examples: name the method, not who implements it.
