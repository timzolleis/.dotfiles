---
name: go-architecture
description: "How we shape Go services and clients: module layout, dependency direction, ports at I/O, test doubles, errors, state, wiring, and observability. Use when designing, restructuring, or reviewing Go code."
---

# Go architecture

How [architecture](~/.agents/skills/architecture/SKILL.md) and [code-style](~/.agents/skills/code-style/SKILL.md) apply in Go. Where the Effect pattern ([effect-ddd](~/.agents/skills/effect-ddd/SKILL.md)) disagrees, this file wins in Go. References: Caddy (one module shape, interface guards), Tailscale (seams at I/O, `tstime`, `tstest`, `cmp.Diff`), cli/cli (a factory that hands every dependency to commands).

## Modules

- **A package is a capability**: `batch`, `document`, `job`. It holds the domain types, the rules, the service, and the ports that service needs. Every capability package has the same shape, so a reader who knows one knows all of them, and an agent copying one copies the right shape.
- **A subpackage is a real alternative implementation**: `httpapi`, `sqlite`, `jsonfile`. It imports its capability package; the capability never imports it.
- **Test doubles live next to their only user.** A double that one package uses goes in that package's `_test.go` files. Doubles that other packages import go in one `<capability>test` package, together with that capability's contract suite. There are no `memory/` or `mock/` packages: they double the directory count and hide which test uses what.
- **The composition root is one function** (`app.RunClient`). It builds every adapter and service and hands workers to a supervisor. Commands and tests reuse its constructors instead of wiring their own graph.

## Dependencies

- **One direction, enforced by a linter** (depguard). Go already forbids import cycles; the linter forbids an edge that points the wrong way.
- **The side that decides calls the other.** `document` decides that a batch's files can go, so `document` imports `batch`. Never the reverse.
- **A value type has one home.** If two packages each define `DestinationKey`, one of them is wrong. Move the type to the capability that owns the concept, and have the other import it.
- **Domain code never imports runtime or infrastructure packages.** A domain package that needs the supervisor, a transport, or `os` gets a port or returns its own outcome. The composition root maps that outcome to a restart or an exit code.
- **A hub that imports every module's errors is a router in disguise.** For example, a job runner that knows each executor's error types. Either each executor returns the runner's outcome type, or the runner takes a handler per kind (`map[JobKind]JobHandler`) that the composition root registers. Then the runner imports none of them.

## Ports

- **A seam sits only at I/O**: network, disk, database, clock, randomness, OS services. In tests, fake that seam and run every layer above it for real.
- **The consumer owns the interface.** It declares the smallest interface it needs, unexported, in its own package; the provider exports a concrete type. An interface with one implementation and no fake is deleted.
- **Every adapter has a compile-time guard**: `var _ batch.BatchRepository = (*BatchRepository)(nil)`.
- **Wire types stop at the adapter.** JSON bodies, rows, and vendor structs become domain types inside the adapter; the service never sees a DTO.
- **A layer earns its place** with real behaviour: caching, retries, merging sources, validation, translation. A service method that only forwards to the layer below is deleted, and callers use the layer below.
- **One way to ask a question.** Every caller that asks "is the device connected?" goes through the same port. Three spellings of one question mean the port is missing.

## State and ownership

- **One owner per fact.** One package reads and writes each fact. A type that combines facts owned by several packages is a read model, built where a caller needs it, not an aggregate.
- **Derived data records what it belongs to.** A key bound to a device stores its `DeviceID`; a key bound to an organization stores its `OrganizationID`. Then every read can check the binding, and the rule holds on every path, not just on the path that cleans up.
- **Never delete what you can't get back.** Data that may be the only copy (a private key, a user's file) is treated as missing when it is stale; it stays on disk.
- **States as types only where they carry their own data and there are three or more of them.** For a fact that is either there or not, return `(T, error)` with a typed "missing" error.

## Errors

- **Typed errors with pointer receivers**, matched with `errors.As`, named for what happened:
  - `Missing<Thing>Error` for absent data
  - `<Subject>Not<State>Error` for a subject that isn't in a state yet, e.g. `DeviceNotConnectedError`
- `ErrX` is only for a sentinel variable (`io.EOF`, `os.ErrNotExist`); staticcheck ST1012 enforces the prefix.
- **Wrap every error passed upward** with `fmt.Errorf("<what this layer was doing>: %w", err)`, so a log line reads as a path through the layers.
- **Map errors once, at the edge.** An adapter turns a vendor status into a domain error, e.g. a 401 with a known tag becomes `APIKeyRefusedError`. Inside the edge, code matches domain errors only.

## Domain logic

- **Decisions are pure functions that take `now`**: `connectedDeviceFromCurrentDevice(request, currentDevice, now)`. The service reads, calls the decision, and writes.
- **No command → event → `FromEvent` ceremony.** An event type exists only when something publishes or stores it. Otherwise the decision function returns the new state directly.
- **Value types carry behaviour**: `APIKey.String()` returns `[secret]`, a URL type validates itself.

## Concurrency

- **Long-running work is a worker**: a `Run(ctx) error` method, started by the supervisor, stopped by cancelling `ctx`.
- **A mutex field names what it guards.** A method that expects the lock to be held ends in `Locked`. Keep one mutex per struct, so there is no lock order to remember.
- **Time comes from the injected clock**, never from `time.Now` or `time.After` directly, so tests can advance it.

## Tests

- **Behaviour tests through the service**, with the real service on top of fakes at the I/O seam.
- **Every repository has one contract suite** that every adapter and the in-memory fake run, as rclone's `fstest` does.
- **Compare structs with `cmp.Diff(want, got)`** and print it with `(-want +got)`.
- **CLI behaviour is tested with `testscript`** (txtar) where commands, flags, and files interact.

## Observability

- **Set up OpenTelemetry once, in the composition root**: a TracerProvider, a MeterProvider, and an slog bridge, exported over OTLP with batching. The client keeps working when the collector is unreachable.
- **Instrument at the edges, not in the domain**:
  - the HTTP transport: `otelhttp.NewTransport`, once, in the server client constructor
  - the `database/sql` handle
  - one span per worker iteration, in the supervisor or the worker loop
  - one span per incoming request on a server
  
  Domain packages take `ctx` and never import otel.
- **No secrets or personal data in attributes.** Record IDs and outcomes; never API keys, file names, or document content.

## Sequencing

- **A behaviour fix ships before a refactor**, in its own PR, with its migration. A refactor PR changes no behaviour.
- **Untangle dependencies before restructuring modules.** A moved type or a reversed edge changes many imports, and a layout change on top of a wrong edge makes that edge permanent.
