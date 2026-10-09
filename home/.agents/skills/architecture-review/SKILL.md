---
name: architecture-review
description: Scan a codebase for deepening opportunities against effect-architecture, present them as a visual HTML report, then grill the one you pick.
disable-model-invocation: true
---

# Architecture review

Surface architectural friction and propose **deepening** opportunities: refactors that turn shallow modules into deep ones and move code toward `effect-architecture`. Use the terms in `effect-architecture/vocabulary.md` exactly, and the domain terms in `CONTEXT.md`. Read `effect-architecture/deepening.md` before judging a candidate.

## 1. Scope, then explore

Deepening pays off where code keeps changing. Take the direction the user named; otherwise walk a good stretch of `git log --oneline` to find the hot spots and look there first. Read `CONTEXT.md` for the area.

Explore with sub-agents when the harness offers them, and note friction rather than following a checklist:

- Understanding one concept means bouncing between many small modules.
- A module is shallow: its interface is nearly as complex as its body.
- A rule lives in the wrong module kind: a decision in a repository, a mapper where a codec belongs, a service that only forwards.
- A module works on more than one core type.
- Behavior is untested, or testable only past its interface.

Apply the deletion test to every suspect: deleting it should concentrate complexity, not just move it.

Complete when every candidate has files, the friction it causes, and a deletion-test result.

## 2. Report as HTML

Write a self-contained file to `${TMPDIR:-/tmp}/architecture-review-<timestamp>.html`, open it, and give the absolute path. Follow [HTML-REPORT.md](HTML-REPORT.md). Each candidate card has:

- **Files** involved;
- **Problem**: the friction, in terms of depth and module kinds;
- **Solution** in plain words;
- **Benefits** in locality, leverage, and how tests improve;
- a **before/after diagram**;
- **Recommendation strength**: `Strong`, `Worth exploring`, or `Speculative`.

End with a **Top recommendation**. Propose no interfaces yet; ask which candidate to explore.

## 3. Grill the pick

For the chosen candidate, read `~/.agents/skills/grill/SKILL.md` completely and follow it: constraints, dependencies, the deepened shape, what sits behind the seam, which tests survive. Bring the deepened shape as a before/after module map first, then one module section per changed module, in the formats of `~/.agents/skills/codebase-design/SKILL.md` (read its "Module map" and "Module section" headings). For alternative interfaces, use `~/.agents/skills/codebase-design/design-it-twice.md`. Write locked terms into `CONTEXT.md` as they lock.

Complete when the candidate is locked or rejected. A locked refactor too large for one context continues in `codebase-design`, which grows its spec.
