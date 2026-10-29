# Naming

Names are truthful and greppable: the name alone says what a thing is or does, without its arguments, its return type, or the surrounding code filling the gap, and a search for it finds only it.

- Name the subject: `findActiveAbsenceById`, `publishAbsenceEvent`. `findById`, `publish`, `execute` match thousands of lines.
- An action starts with its verb: `archiveAbsence`, `generateAbsenceId`.
- A translation names its output and its input: `absenceVisibilityFromReader(reader)`, `absenceActorFromPermissions(…)`, `dateTimeUtcFromDate(date)`. `visibilityFor(reader)`, `mapTo`, `toHttpError`, `absenceFrom(row)` each leave one side to the arguments or the return type.
- A name never ends in a preposition its argument completes: `certificateRenewableFrom(certificate)`, `isDomainWithin(…)`, `visibilityFor(reader)`. Name the thing itself: `certificateRenewalStart(certificate)`, `isDomainWithinParentDomain(…)`. A translation (`dateTimeUtcFromDate`) names both sides, so it ends in a noun.
- Variables too: `absenceBeforeUpdate`, `previousPeriod`; not `before`, `prev`, `data`, `result`.
- Plain words in the domain's language that say what the thing is; no borrowed jargon (`Roster` for "the persons already signed up").
- A state says the fact its find checked (`ActiveAbsence`), not what you may do with it (`ArchivableAbsence`).
- Prefix a concept by its variant only where the variants' fields differ (`SchoolSubmission` / `GroupSubmission`); shared ids stay unprefixed (`SubmissionId`).
- Grep a new name before you use it: one another module already uses (`Registration` for account sign-up) is taken.
- Files are kebab-case (`absence-rule.ts`); identifiers are camelCase / PascalCase.

| Thing | Pattern | Example |
|---|---|---|
| State | `<Phase><Type>` | `DraftAbsence` |
| States a transition accepts | the fact they share; what they allow only when no fact names them | `EditableAbsence` (draft or active) |
| Transition, its input | `<verb><Type>`, `<Verb><Type>Input` | `archiveAbsence`, `ArchiveAbsenceInput` |
| Rule type, list | `<Verb><Type>Rule`, `<verb><Type>Rules` | `ArchiveAbsenceRule`, `archiveAbsenceRules` |
| Single rule | the rule as a sentence + `Rule`, without the subject (the file names it); "Permitted" = the actor holds the flag | `cannotArchiveWhileOngoingRule` |
| Event | `<Type><PastTense>Event` | `AbsenceArchivedEvent` |
| Domain error | `<Fact>Error`; *still* = not yet, *already* = past it | `AbsenceStillDraftError` |
| HTTP error | domain error name + `Http` | `AbsenceStillDraftHttpError` |
| Actor, flag | `<Type>Actor`, `may<Verb>…` | `AbsenceActor`, `mayEditOthersAbsences` |
| Repository find | `find<State><Type>ById` | `findActiveAbsenceById` |
| View read | `get…` / `list…` | `getAbsenceById`, `listAbsences` |
| Use case, command | `<Verb><Type>Service`, `<Verb><Type>Command` | `ArchiveAbsenceService`, `ArchiveAbsenceCommand` |
| Translation | `<output>From<input>` | `absenceActorFromPermissions`, `absenceHttpErrorFromAbsenceError` |
| Permission key | the host's format | `absences:update` |
