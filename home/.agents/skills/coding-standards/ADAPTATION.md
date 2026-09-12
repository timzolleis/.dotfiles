# Provenance & local adaptations

Vendored from **[dmmulroy/skills](https://github.com/dmmulroy/skills)** (MIT), which itself vendors
the `grilling` / `tdd` skills from **[mattpocock/skills](https://github.com/mattpocock/skills)**.
Thanks to Dillon Mulroy and Matt Pocock.

This is an **adapted** copy, not a verbatim mirror. Re-syncing from upstream will overwrite these
changes — re-apply the deltas below if you do.

## What was changed for this setup

- **Effect version.** `EFFECT.md` is now **v3-authoritative** (every repo here is `effect@3.21.x`)
  with v4 deltas labeled `**[v4]**` for the planned migration, instead of v4-beta-only.
- **Service form settled.** `EFFECT.md` now mandates `Context.Tag` (interface-first) for new/changed
  modules and marks `Effect.Service` as legacy — matching the global `~/.pi/agent/AGENTS.md`. Upstream
  left this an open "known gap."
- **Layer naming settled.** `layer` (deps in `R`) / `layerLive` (fully-wired production, `R = never`) / `layerMemory` / `layerFromEnv`. Standalone `<Name>Live` consts are the legacy form of the wired layer.
- **Tagged errors.** `Schema.TaggedError` (v3) / `Schema.TaggedErrorClass` (v4), not v4-only.
- **v4 migration appendix.** The v4 deltas that used to live in the global agents file (packages/imports,
  catch renames, HttpApi config-object shape, middleware, `toWebHandler`, `Context.Reference`, layer
  memoization, `Runtime` removal) were consolidated into `EFFECT.md`'s appendix so the always-loaded
  global file stays lean. Cloudflare-specific notes (`@effect/sql-d1` + drizzle) were dropped per the
  runtime-agnostic rule.
- **Persistence = Prisma.** `TESTING_AND_VERIFICATION.md` + `EFFECT.md` replaced the Drizzle /
  better-sqlite3 / D1 guidance with Prisma + the project's Prisma test layer (real migrations).
- **Runtime deferred to local.** `CLOUDFLARE_ARCHITECTURE.md` was removed; Cloudflare/Workers/Alchemy
  assumptions were stripped from the core. Deployment-runtime specifics defer to each repo's local
  CLAUDE.md. The core standards stay runtime-agnostic.
- **Toolchain.** Vite+ (`vp test`, `vite-plus/test`, Oxlint/Oxfmt) genericized to "the project's
  established toolchain" — these are `pnpm` monorepos.
- **Workflow routing.** `tech-spec` / `improve-codebase-architecture` route their grilling step to the
  installed **`grill-me`** skill and their testing step to the installed **`tdd`** skill.
- **Load timing.** This package is loaded while specifying and reviewing, not during implementation.
  See `SKILL.md`.
- **`code-review` → `standards-review`.** Renamed to avoid shadowing the built-in `/code-review`
  (cloud "ultra" mode). Same standards-backed, proof-required, review-only behavior.

## Installed pieces

- `coding-standards/` — the standards package (model-invoked).
- `tech-spec/` — typed call-stack architecture handoff (user-invoked).
- `standards-review/` — standards-backed review (user-invoked).
- `improve-codebase-architecture/` — replaced the prior same-named skill (user-invoked).

Not installed (existing equivalents kept): `tdd`, upstream `grilling` / `grill-with-docs` /
`code-review`.
