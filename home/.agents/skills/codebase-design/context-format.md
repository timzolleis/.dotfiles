# CONTEXT.md format

`CONTEXT.md` is a repository's durable domain glossary. Write a term into it the moment the user locks it.

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Announcement**:
A message the school sends to a chosen audience of parents.
_Avoid_: notice, post

**Draft**:
An announcement that is not yet visible to recipients and can still change freely.
_Avoid_: unpublished announcement
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick one and list the others under `_Avoid_`.
- **Define what a term is, not what it does**, in one or two sentences.
- **Only terms specific to this domain.** General programming concepts belong in `effect-architecture/vocabulary.md`.
- **Group terms under subheadings** when natural clusters emerge.

## One context or several

- One `CONTEXT.md` at the repository root by default; create it lazily with the first locked term.
- When the repository holds several bounded contexts, a root `CONTEXT-MAP.md` lists each context, where its `CONTEXT.md` lives, and how the contexts relate (events, shared types).
- Infer which context a topic belongs to; ask when it is unclear.
