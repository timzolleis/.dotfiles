# Naming

Agents find code by plain-text search and read small windows around the hits. They have no hover text, no jump-to-definition, and no memory between sessions. Every identifier is a search query, and every name, signature, doc comment, and test name is a contract a caller trusts without reading the body. Write code that resolves in one search instead of five.

## Names are search queries

- **Exported symbols and service or repository methods get 2–4 words, at least one a domain word**: `diffUserObjects`, not `diff`; `findAnnouncementById`, not `find`. One-word names collide with every other module's `find`, `list`, and `delete` (61% globally unique in a large monorepo; three words, 96%; four or more, 98%). Use the shortest name that greps uniquely.
- **Give generic verbs their object**: `sanitizeEmailHtml`, not `sanitize`; `validateSmtpConfig`, not `validateConfig`. Qualify only as far as uniqueness requires.
- **Locals and module-private helpers that hold a domain value name it**: `procuratPersonDisplays`, not `displays`; `toProcuratPersonEntities`, not `toEntities`. A one-word name fits only a lambda parameter whose whole scope fits on screen.
- **Never rely on the folder, the import, or the receiver to disambiguate** (`users/diff.ts`, `announcementRepository.find`). The import sits at the top of the file; the search hit is at line 300. Put the context in the symbol (`formatDurationMs`). Exception: a rigid convention where the path carries the meaning (every contract file exporting `Input`/`Output`).
- **One concept, one spelling.** Reuse the codebase's vocabulary; `organizationId` everywhere, never also `orgId`. Every synonym splits every future search in half.
- **One definition site per symbol.** Move code and rewrite it to current guidance, never copy it; delete the origin in the same change. A shared helper gets one concept-named home and is imported everywhere else.
- **No bare-role filenames** (`config.ts`, `types.ts`, `utils.ts`, `helpers.ts`, `handlers.ts`). Prefix the domain: `billing-plan-config.ts`. `index.ts` only as a thin re-export.

## Names tell the truth

- **Name an operation for everything it does, verb first**: `getNotificationTemplateForChannel`, not `resolveTemplate`. `get`/`find`/`check` only read; a function that also writes says so (`getOrCreateDraft`).
- **Name a thing for what its caller can do with it, in domain words, not for the mechanism behind it**: `where`, `store`, `subscribe`, not `subset`, `sink`, `mount`. This holds for internal variables, services, methods, and call-tree nodes as much as for exports.
- **Name a value for what it is, not who uses it**: `UserStore`, not `UsersForPasswordReset`. The consumer belongs at the call site.
- **Replace empty labels** (`handle`, `process`, `resolve`, `manager`, `context`, `data`) with the actual action or content. Use an architecture word (`Repository`, `Gateway`) only when it is the thing's established role.
- **Name for the actual scope.** A broad name fits a broad capability; a module narrowed to one job narrows its name.
- **Qualify an implementation by the difference a caller observes**: `PostgresUserStore`, `RecordingEmailSender`, `NoopEmailSender`. A test double behaves exactly as its name claims.
- **Fix a name, signature, comment, or test name in the change that makes it untrue**, including a private helper that other modules now import. A stale name is misinformation every reader trusts.
- When no truthful name comes, the design is murky: reshape the code instead of choosing a vague name.

## Types are the documentation agents cannot skip

- **Types claim only what was checked.** Brand primitive IDs, so `transferOwnership(userId, organizationId)` with swapped arguments fails the build; model state as discriminated unions, not clusters of nullable fields; never cast into a branded or decoded type.
- **Require a capability type for a privileged operation** (`AuthorizedOrganizationId`, an organization-scoped client), not a comment asking callers to check first.
- **Name types as they will be quoted back** in compiler errors, the message an agent self-corrects from: `AuthorizedOrganizationId` explains itself, `Ctx2` does not. Every `any` is a spot where the compiler goes silent.

## Say it where the search lands

- **Doc comments are rare.** Write one only for the constraint the name and signature cannot show (units, timezone, ownership, ordering); it claims no more than the code guarantees and does not restate the name or type. When you write one, use the plain-words phrase someone would search for ("session has expired" above `SessionExpiryChecker`).
- **A module makes sense with its imports unread.** Each imported name says enough that the reader never opens the source module; when they must, the import's name is failing.
- **Each question-sized concept has one named home.** The code that answers "where is X done?" lives in a module named after X, not inline in a coordinator; an orchestrator reads as a sequence of calls into named modules. A helper meaningful only inside one concept stays inline there.
- **Keep strings whole.** Never build event names, flags, error codes, or a message's literal phrases by interpolation; write the full literal. A message interpolates only identifiers.
- **Error messages say what failed, why when known, and how to recover when someone can act.** Start with a unique literal prefix, so a message in a trace greps back to its definition; append identifiers from the error's fields: `` `Procurat is not configured for organization ${organizationId}; add its credentials in the organization settings` ``. Callers branch on the tag and fields, never on message text.
- **Mark dead ends** with `@deprecated` and a pointer to the replacement.

## Architecture names

| Thing | Pattern | Example |
|---|---|---|
| State | `<Phase><CoreType>` | `DraftAnnouncement` |
| Read model | the question it answers | `AnnouncementInboxEntry` |
| Domain error | `<Fact>Error` | `AnnouncementNotDraftError` |
| Policy | verb + question | `getAnnouncementRevision` |
| Read | `find`/`list`/`count` + core type | `findAnnouncementById`, `listAnnouncements` |
| Transition | business verb + core type | `publishAnnouncement`, `editAnnouncementDraft`, `markAnnouncementViewed` |
| Success codec | `<Type>Response` | `PublishedAnnouncementResponse` |
| Error codec | `<DomainError minus Error>HttpError` | `AnnouncementNotDraftHttpError` |
| Span | `<Service>.<method>` | `AnnouncementService.publishAnnouncement` |

## Before handing off

1. Does one search for each new name find its definition?
2. Would swapping two arguments of a new function fail the build?
3. Is the one thing a caller must know but the name and signature cannot say written at the definition?
4. Does every log and error string exist verbatim in the source?
5. Did anything change behavior without changing its name?
6. When code moved, is it gone from where it came from?
