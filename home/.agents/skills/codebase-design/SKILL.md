---
name: codebase-design
description: Design a change together with the user — a feature, an integration, or a refactor — reaching common ground in conversation, then drafting the spec in one piece for the user to annotate. Use when a change touches something other code or people depend on and is too large to just do.
---

# Codebase design

## The ideal shape

We start from what exists, if anything: how it works today and what it has to keep. Then we agree on the use cases we want to offer: what people *do* (commands) and what they want to *know* (questions). The use cases give us the language: the core types, their states, the verbs. Then we decide the structure: which modules own what and where the seams are, as a **module map**. Most of the design happens here and in the **module sections** that follow, one per module or changed path; the code inside a section (queries, codecs, helpers) is mostly mechanical. We reach common ground in conversation up to the module map; then you draft the sections and slices in one piece, and the user annotates the draft.

Real changes rarely follow this exactly. Treat it as the direction, and use the moves below to get there by whatever route the change needs.

## The rule

**Take next the decision other decisions depend on.** Say which move you are making and why, so the user can redirect. Each decision follows the pairing loop in `AGENTS.md`; the architecture behind every proposal is `effect-architecture`.

## Common ground

The goal, what exists, the use cases, the terms, and the module map are what every later decision depends on; a wrong owner or seam is the expensive mistake. Settle them in conversation. Each turn makes one move and brings one decision (or a small group that belongs together): the recommendation, the smallest piece of the module map or a module section that makes it concrete, the trade-off, the alternative. Then it stops and waits for the user.

Conversation and spec use the same two formats, so a locked sketch moves into the spec unchanged and the user reviews one shape, not two.

- **First turn:** read the code the change touches, say back the goal in one or two sentences, name the first move and why, and bring its first decision. Nothing more.
- **Do not draft past the current move** while common ground is open. No outline of later moves, no list of every open question. Later decisions depend on this one; showing them first decides them silently.
- **Only the user locks.** A decision is locked when the user agrees, reshapes and agrees, or says so. Your own recommendation is a proposal until then.
- **Write nothing before the first lock.** No spec file, no skeleton, no headings.

For a small change (one context, no new dependency), common ground and draft are one sketch.

## The draft

Once the module map is locked, draft every module section it names and the slices in one piece, then submit it for review (below). The user reads the whole draft and annotates it in one pass, which costs them far fewer turns than one decision at a time. A choice you make inside a section shows as its `Cases`, `Cost:`, or `Rejected:` line, so an annotation can catch it. When drafting surfaces a question about the map or a common-ground decision, ask before continuing.

## Module map

The structure of the change. One line per module: its identifier, what it owns, and its adapters after `·` when it is a seam. A child is a dependency of its parent. Nodes are modules, not calls; a path through them is a call tree (`AGENTS.md`). Mark changes with `-` and `+` as in a call tree.

```text
  AnnouncementApiGroup             HTTP edge
  └─ AnnouncementService           publish, archive
     ├─ AnnouncementPolicy         who may publish
     ├─ AnnouncementRepository     announcement rows
+    └─ ParentDirectory            parents of a class · layer, layerMemory
```

Lock the map before drafting the sections it names: a section on an open map decides the structure silently.

## Module section

One module, or one changed path, with only the parts its decision needs. Each part answers one kind of question, so each fact has one obvious place:

| Part | Include when | Shows |
|---|---|---|
| Heading, `Owns:` | always | the owner's identifier; what it owns, one line |
| Interface | callers depend on it | signatures with their error channels |
| Adapters | it is a seam | adapter names, one line |
| Call tree | the path needs one (`AGENTS.md`, Call trees) | the tree, then its tests in the defense format of `effect-architecture/testing.md` |
| Cases | behavior varies by input | `input → outcome`, one line each |
| Pseudocode | logic inside one function was itself the decision | only those lines; the rest is `…` |
| `Cost:`, `Rejected:` | a cost someone will notice; an alternative an implementer would reach for | one line each |

```text
### AnnouncementService.publishAnnouncement
Owns: publishing a draft and announcing it

publishAnnouncement(args: { organizationId; announcementId; by }): Effect<PublishedAnnouncement, AnnouncementNotFoundError | AnnouncementNotDraftError>

  AnnouncementService.publishAnnouncement(args)
  ├─ AnnouncementRepository.findAnnouncementById(organizationId, announcementId) → AnnouncementNotFoundError
  ├─ AnnouncementRepository.publishAnnouncement(draft, by) → AnnouncementNotDraftError
  └─ EventClient.publish(AnnouncementPublishedEvent)

AnnouncementRepository.publishAnnouncement rejects an already-published row      [repository · real database]
  …

Cases
  draft               → PublishedAnnouncement, one event
  already published   → AnnouncementNotDraftError, no event

Rejected: AnnouncementRepository.updateAnnouncement(changes) — every caller would repeat the draft guard.
```

Leave out a part that has nothing to say; never fill it. A section that needs every part is usually two modules.

## Moves

| Move | Use when | Output |
|---|---|---|
| Map what exists | there is code, a schema, or consumers to respect | the current module map and call trees, fixed constraints (wire contracts, schema, consumers), pain points |
| Use cases | the intent is fuzzy | actor + intent, each marked command or question |
| Name it | terms are vague, overloaded, or new | terms written into `CONTEXT.md` as they lock ([context-format.md](context-format.md)) |
| Lifecycle | something has states | state diagram, the rule on each transition (a type, a policy, or a guard) |
| Module map | before the draft, and whenever a module is added, split, or merged | the map with its changes |
| Module section | the map names a module or path whose shape is not mechanical, including a codec at an edge; in the draft, or in conversation when an annotation reopens it | one section |
| Design it twice | the shape is unclear or contested | 2–3 radically different maps, compared ([design-it-twice.md](design-it-twice.md)) |
| Grill | a design feels settled | read `~/.agents/skills/grill/SKILL.md` completely and follow it |

Use-case wording maps onto the architecture: a noun becomes a core type, a phase a state, a verb on a state a transition, "sees" or "counts" a question, and "only if" the rule on a transition.

## The spec

The spec is the record of the conversation, never its starting point. A change that fits one context and adds no dependency needs no spec: lock it in conversation, implement it, report, and ask for `/plannotator-review`. For anything larger, create `plans/<change>.md` after the user locks the first decision, containing only that decision.

- **During common ground, write only what was locked, right after it locks**, and say in one line what changed in the spec. A lock rewrites the part it belongs to in place; it never adds a fragment somewhere else. The draft is the one step that adds unlocked content: all module sections and the slices at once, as a proposal for review.
- **The layout is the conversation's formats in map order:**

  ```text
  # <Change>
  <goal and scope, one or two lines>
  ## Use cases            when that move was made
  ## Lifecycle            when that move was made
  ## Modules
  <module map>
  ### <Module>            one section per module or changed path, in map order
  ## Slices
  ```

  A type several sections share (a model, a field list) gets its own section before the sections that use it.
- **No decisions table.** A decision lives in the section it shapes; `Cost:` and `Rejected:` carry what the section's code cannot show.
- **Slices**: a `## Slices` section of `- [ ] 1. <Title> — <what it delivers, the module sections it builds, and its checks>` lines, which `/implement` parses.

## Review and build

1. When the draft is written, make a **compose pass**: read the spec top to bottom as one document, and move, merge, or cut until each fact sits in one section. It adds no decision. Then enter Plannotator plan mode and submit the spec. Plan mode comes on only now: its planning prompt asks for a skeleton plan and batched questions, which this workflow replaces.
2. Apply annotations to the draft directly and resubmit. Discuss in conversation only an annotation that reopens the module map or another common-ground decision, one at a time, and update the spec once it locks.
3. After approval, the user runs `/implement` per slice and reviews each with `/plannotator-review`.
4. Delete the spec once its last slice lands. Plannotator's archive keeps the history; `CONTEXT.md` keeps the language.

Complete when the spec is approved, or when an inline change has been implemented and reported.
