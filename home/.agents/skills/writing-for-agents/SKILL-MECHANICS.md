# Skill mechanics

## Invocation

Choose invocation based on who must select the workflow.

### Model-invoked

Use when the agent must discover the skill automatically or another skill must route to it.

- Keep a precise trigger description.
- Omit `disable-model-invocation`.
- Accept permanent context load for automatic discovery.

### User-invoked

Use when human intent should select the activity.

- Set `disable-model-invocation: true`.
- Keep the description short and human-facing.
- Accept that the human must invoke `/skill:<name>`.

A model-invoked description adds discoverability; it does not prevent explicit invocation.

## Splitting by invocation

Split a skill only when a distinct activity needs its own invocation or another workflow must reach it independently. Each model-invoked skill adds an always-loaded description, so independent discovery must earn that cost.

A user-invoked skill cannot reliably route to another hidden user-invoked skill through discovery alone. Either:

- make the target model-invoked;
- point to its exact file path and require a complete read; or
- keep the workflow in one user-invoked skill.

## Router skills

When there are too many explicit commands to remember, add one user-invoked router that lists which command to invoke for each activity. Keep it as an index; workflow rules remain in their owning skills.

## Completion check

Complete when the invocation mode matches who owns the decision, the description names only real trigger branches, and no workflow rule is duplicated between a router and its target.
