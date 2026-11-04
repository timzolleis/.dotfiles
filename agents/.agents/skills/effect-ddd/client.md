# Client

The browser renders the domain; it never implements it. Everything that interprets, validates, derives, or builds a domain value lives in the module's `domain/` and is tested there. The web imports it. What is left in the web is rendering and input handling.

`domain/` is pure ([SKILL.md](SKILL.md) rule 1), so it is browser-safe: the web imports schemas, rules, transitions, and constants straight from it. `application/`, `view/`, `infrastructure/`, and `http/` never reach the browser, except the HTTP API definition for the typed client.

## What the web takes from the domain

| Knowledge | Lives in | The web |
|---|---|---|
| A value's format and its error text | the schema's check: `AbsenceReasonName = Schema.Trimmed.check(Schema.isNonEmpty({ message: "Enter a name." }))…` | decodes the input with it and shows the issue's message |
| Limits (lengths, counts, ranges) | an exported constant the schema uses: `maxAbsenceReasonNameLength` | passes the constant to `maxLength` |
| A refusal ("name taken", "still ongoing") | the rule and its error | calls the rule or the transition, maps the error tag to copy |
| Which variants exist | the union's `.cases` / the literal list | lists them from it |
| Which fields a variant has | the variant's schema | binds inputs to its keys |
| Who may do it | `may…` on the actor ([access.md](access.md)) | calls the same function with the user's permissions |
| The optimistic row | the transition: `archiveAbsence({ absence, actor, now })` | applies the event's result; the server's answer replaces it |
| "Same value" | the value's `Equivalence` ([model.md](model.md)) | compares with it |

## Rules

- No restated domain literal in the web: no regex, limit, reserved key, variant name in a conditional, or error text the schema already has. Grep `web/` for them before handing over.
- A branded value stays branded from the input to the request: decode once where the user's text becomes a value, then pass the `AbsenceReasonName`, never a `string` that is trimmed and decoded again downstream.
- Form state mirrors the domain shape (`Keyed<T> = T & { formKey }` per row), so a schema issue's path walks the form directly. No `Record<string, …>`, `Map<string, Json>`, or `JsonObject` in the middle of a typed flow.
- Narrow by tag (`Match.valueTags`, `$match`), never by `in` or by a property's presence.
- A view row the sync decoded is used decoded; it isn't encoded again to feed a form.
- Copy is the web's: words, labels, and layout. When a sentence restates the domain (a rule as prose, a summary of a definition), the domain returns its structured parts and the web only picks the words.
