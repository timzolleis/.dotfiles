# Naming

Agents find code by plain-text search and read small windows around the hits. Every identifier is a search query, and every name, signature, doc comment, and test name is a contract a caller trusts without reading the body.

## Names are search queries

- **Exported symbols and service or repository methods get 2–4 words, at least one a domain word**: `sanitizeEmailHtml`, not `sanitize`; `findAnnouncementById`, not `find`. One-word names collide with every other module's `find`, `list`, and `delete` (61% globally unique in a large monorepo; three words, 96%). Qualify only until the name greps uniquely; never rely on the folder, the import, or the receiver (`announcementRepository.find`) to disambiguate.
- **One concept, one spelling.** Reuse the codebase's vocabulary; `organizationId` everywhere, never also `orgId`.
- **One definition site per symbol.** Move code and rewrite it to current guidance, never copy it; delete the origin in the same change.
- **No bare-role filenames** (`config.ts`, `types.ts`, `utils.ts`, `helpers.ts`). Prefix the domain: `billing-plan-config.ts`. `index.ts` only as a thin re-export.
- **Keep strings whole.** Never build event names, flags, error codes, or a message's literal phrases by interpolation; write the full literal. A message interpolates only identifiers.
- **Error messages say what failed, why when known, and how to recover when someone can act.** Start with a unique literal prefix, so a message in a trace greps back to its definition; append identifiers from the error's fields: `` `Procurat is not configured for organization ${organizationId}; add its credentials in the organization settings` ``. Callers branch on the tag and fields, never on message text.
- **Doc comments use the plain-words phrase someone would search for** ("session has expired" above `SessionExpiryChecker`).
- **Mark dead ends** with `@deprecated` and a pointer to the replacement.

## Names tell the truth

- **Name an operation for everything it does, verb first**: `getNotificationTemplateForChannel`, not `resolveTemplate`. `get`/`find`/`check` only read; a function that also writes says so (`getOrCreateDraft`).
- **Name a thing for what its caller can do with it, in domain words, not for the mechanism behind it**: `where`, `store`, `subscribe`, not `subset`, `sink`, `mount`. This holds for internal variables, services, methods, and call-tree nodes as much as for exports.
- **Name a value for what it is, not who uses it**: `UserStore`, not `UsersForPasswordReset`. The consumer belongs at the call site.
- **Replace empty labels** (`handle`, `process`, `resolve`, `manager`, `context`, `data`) with the actual action or content. Use an architecture word (`Repository`, `Gateway`) only when it is the thing's established role.
- **Name for the actual scope.** A broad name fits a broad capability; a module narrowed to one job narrows its name.
- **Qualify an implementation by the difference a caller observes**: `PostgresUserStore`, `RecordingEmailSender`, `NoopEmailSender`. A test double behaves exactly as its name claims.
- **Types claim only what was checked.** Brand primitive IDs, model state as discriminated unions, never cast into a branded or decoded type.
- **A doc comment claims no more than the code guarantees** and does not restate the name or type. Write it where the search lands: the one constraint the signature cannot show (units, timezone, ownership, ordering).
- **Fix a name, signature, comment, or test name in the change that makes it untrue**, including a private helper that other modules now import.
- When no truthful name comes, the design is murky: reshape the code instead of choosing a vague name.

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
