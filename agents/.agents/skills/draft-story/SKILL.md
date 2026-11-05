---
name: draft-story
description: Pair with the person on a story: explore the area and the approaches together, then condense what was settled into the story file. Invoke as /skill:draft-story <area or story path>. Never delegated to a sub-agent.
disable-model-invocation: true
---

# Draft a story

The story is where the person's judgment enters; everything after it is agents. Drafting it is pairing: they bring the goal, the constraints, and the domain; you bring the code, the options, and a recommendation on each. Nothing is settled without them, and nothing is written into the story that wasn't settled in the conversation. Shape of the result: `~/.agents/skills/effect-ddd/story.md`; the architecture it has to fit: `~/.agents/skills/effect-ddd/SKILL.md`. Read both first, then the code the area touches or is modeled on.

## 1. Frame

Start by asking for what only they have, in one message: the goal in their words, the constraints (must, never, out of scope), what exists that this is like, and who the users are. Say what you already found in the code that bears on it. Then stop and let them talk. Capture what they say as a working note at the top of the chat, not in the story yet: goal, constraints, out of scope, open.

## 2. Explore

A conversation, one topic per turn, in the order the decisions depend on each other: the use cases → what the domain decides on and its lifecycle → the rules and their edge cases → effects on other areas → the UI. A turn is as long as its topic needs and no longer, and it is always one of:

- **Options**: two or three approaches, each in a line or a short sketch, with what it costs and what it rules out; your recommendation and why; the question. Discussion material belongs here: a lifecycle diagram, a call tree, a signature, a table of cases: anything that makes the choice concrete, knowing none of it goes into the story.
- **Pushback**: a constraint they gave that conflicts with another, a rule whose consequence they may not want, an edge case that would make the code much harder. Name it, say what it costs, ask.
- **A question** you can't answer from the code: who notices, how often, what the domain word is.

Never: two topics in one turn; a finished story or a finished part before the exploration is done; deciding an open point yourself because the answer "seems obvious"; drafting ahead of the current topic. They may jump topics or change an earlier decision: follow, apply the change to the note, continue.

Explore is done when the use cases are named, the lifecycle is chosen, every rule has a reason and its refusal, and the person says they want it written. Ask that; don't assume it.

## 3. Condense

Write the story from the note and the conversation, part by part in the story's order, each part shown as it will stand in the file and confirmed before the next: a part is a table or a few numbered lines, so this is quick. Rejected approaches from Explore become `Rejected:` lines; costs they accepted become `Cost:`; reasons they gave become the rules' why and the decisions' why, in their words where they had them. Points they chose to leave open go into `## Open`. Write the file as each part is confirmed, `state: open`.

A change they ask for here is a two-line diff on the file, not a re-draft.

## Where it happens

In the chat while the person is here. When they leave mid-draft, the current topic's open question goes to the Inbox as one `:::question` with the options and your recommendation; the note and the parts so far stay in the chat and the file. Never the whole draft.

## Done

Every part is in the file, `## Open` holds only what they chose to leave open, and they said yes to the last part. Then stop: building is `build-story`, which reads the file, not this conversation. Never launch it yourself.

## Never

- A sub-agent exploring or drafting: the person's answers are the input.
- A story, or a part of one, delivered instead of discussed.
- Signatures, call trees, or file lists in the story: they were discussion material, and the code is their home.
