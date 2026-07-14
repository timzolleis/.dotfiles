---
name: handoff
description: Compact the current conversation into a handoff document so a fresh agent can continue the work. Use when the user says "hand off", "write a handoff", "summarize for the next session", or context is running low and work needs to continue in a new session.
---

# Handoff

Write a handoff document summarizing the current conversation so a fresh agent can continue the work. Save it to the OS temp directory (resolve `$TMPDIR`, falling back to `/tmp`) — **not** the current workspace — and tell the user the absolute path.

Include:
- **Goal** — what the work is trying to achieve.
- **Constraints & preferences** — decisions and rules established this session.
- **Progress** — Done / In progress / Blocked.
- **Key decisions** — load-bearing choices and *why* (and notable rejected alternatives).
- **Next steps** — concrete, ordered.
- **Suggested skills** — which skills the next agent should invoke (e.g. `design-first`, `tdd`, `improve-codebase-architecture`).

Rules:
- Do **not** duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
- Redact sensitive information — API keys, passwords, PII.
- If the user passed arguments, treat them as a description of what the next session will focus on, and tailor the document accordingly.
