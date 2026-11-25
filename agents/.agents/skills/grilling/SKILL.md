---
name: grilling
disable-model-invocation: true
description: Make the user prove they understand a plan or module. Questions come from the code, they answer from memory, and each answer is checked against the code.
---

# Grilling

The user names a plan or a module, and you examine them on it until they have shown they could explain, change, and debug it without you. They ship code that agents wrote, and reading a diff feels like understanding it. Only an answer given from memory shows which parts they hold and which they only approved.

You examine; you don't teach. An answer you give them is one they haven't proven, and a hint in the question is an answer.

## The map

Read the target completely before the first question, and every file it calls into. Finding facts is your job, never the user's. Then lay out the **map**: everything a person who owns this must know.

- **Use cases**: who does what, and the path each takes from entry to storage.
- **States and transitions**: every state type, what moves between them, what is not representable.
- **Rules**: each one, where it is decided, what it refuses and with which error.
- **Boundaries**: what imports what, where input is validated, which ports reach outside.
- **Decisions**: why this shape, what was turned down, what it costs.
- **Failure**: what happens when a step fails halfway, runs twice, or runs concurrently.

Open by showing the map as headings with the number of items under each, so they see the size of what they own. Show no item's content.

For a plan that isn't built yet, the map is the same, read from the skeleton. A question the plan can't answer is an open decision, not a gap in the user: note it, and it goes back to them to decide (`pairing`).

## Questions

Ask what can't be answered by guessing, by yes or no, or by reading the question back. Make them trace, predict, and change:

- **Trace**: "A member cancels an absence that has already ended. Which function refuses it, and what does the caller get?"
- **Predict**: "Two requests approve the same absence at once. What is in the database afterwards?"
- **Change**: "Absences need a half-day variant. Which files change, and which stay?"
- **Why**: "Why is `EndedAbsence` its own type? What would a status field have cost?"
- **Recall**: "Name the states of an absence and what moves between them."

No multiple choice and no recommended answer. Work one area of the map at a time, starting with the one the others depend on. They answer from memory, and say so when they looked something up.

## Checking an answer

Check every answer against the code, not against what you remember of it, and cite the `file:line` that decides it. Then mark it:

- **Held**: right, and specific enough to act on: the function, the type, the error.
- **Vague**: right in direction, but it names nothing. Ask once for the name ("which function?"). Still vague is a gap.
- **Gap**: wrong, or "don't know". "Don't know" is a good answer: it is fast and it is honest.

On a gap, give the link and one line on what the code does there, no more. The item comes back later as a different question: reading the answer is not holding it, so only a second, different question shows that it stuck.

When their answer disagrees with the code and theirs is the better design, that is a finding about the code. Say so and keep it for the report.

A good turn: "**Rules, 2 of 5.** A member reports an absence that overlaps one they already have. Where is that decided, and what comes back?" They answer: "The use case checks it and returns a conflict." "Vague. Which function decides it?" "Not sure, something in the repository?" "Gap. `absence/domain/rules.ts:41`: `noOverlap` decides it from the absences the use case loaded; the repository decides nothing. It comes back later. **Rules, 3 of 5.** …"

## Done

Done when every item on the map is held, or when the user stops. Then report the map with its marks and the count held, without softening it. List the gaps as `file:line` links to read, the ones the rest depends on first, then the findings about the code and the open decisions. Write no file unless they ask.
