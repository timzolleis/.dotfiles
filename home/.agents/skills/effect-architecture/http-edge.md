# HTTP edge

Handlers wire a request to one read or one command. The endpoint's codecs own every wire shape, so domain types never learn how they are serialized.

Example: `examples/v<major>/http-edge.ts` — a `*Response`, a `*HttpError` codec, an endpoint, a handler.

## Rules

- **A handler is decode → policy → one call → return the domain value.** No mapping, no `catchTags`, no decisions.
- **Questions call the repository; commands call the service.**
- **`*Response` schemas declare their wire fields explicitly.** The handler returns the domain value; `HttpApi` encodes it and drops fields the response does not declare. When the domain renames or drops a field, the response's `Type` stops accepting it and `tsc` fails.
- **Use a transform in a `*Response` only when the wire shape differs** from the domain shape (flattening a read model), following [decoding.md](decoding.md).
- **`*HttpError` is a codec over the domain error**: wire struct → `Schema.instanceOf(DomainError)`, with the status annotation on the transform. Handlers fail with domain errors; each endpoint lists the `*HttpError` codecs it can produce.
- **Request schemas decode into commands and branded IDs.** Do not rebrand decoded IDs later.
- **Name by role**: `*Response` for success shapes, `*HttpError` for error codecs. No `Json` or `Dto` suffixes.

## Trade-offs

- Explicit response fields state each wire field twice, once in the domain and once at the edge; `tsc` keeps them in step, and the HTTP contract never changes silently with the domain.
- Error codecs replace per-handler `catchTags`, but an endpoint with several error codecs depends on `HttpApi` choosing the matching `instanceOf` member. Verify that encoding and the OpenAPI output once per codebase before relying on it.
- A client that decodes responses with the same API schema receives domain types.
