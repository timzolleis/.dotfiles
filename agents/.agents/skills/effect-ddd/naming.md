# Naming

Beyond general naming, Effect features name each part by its role:

- Editing an entity's own content is `update<Type>` (`updateAbsenceReason`); no synonym (`revise`, `relabel`). Intent names are for changes with their own rules ([use-cases.md](use-cases.md)).
- A state says the fact its find checked (`ActiveAbsence`), not what you may do with it (`ArchivableAbsence`).
- Prefix a concept by its variant only where the variants' fields differ (`SchoolSubmission` / `GroupSubmission`); shared ids stay unprefixed (`SubmissionId`).

| Thing | Pattern | Example |
|---|---|---|
| State | `<Phase><Type>` | `DraftAbsence` |
| States a transition accepts | the fact they share; what they allow only when no fact names them | `EditableAbsence` (draft or active) |
| Transition, its input | `<verb><Type>`, `<Verb><Type>Input` | `archiveAbsence`, `ArchiveAbsenceInput` |
| Rule type, list | `<Verb><Type>Rule`, `<verb><Type>Rules` | `ArchiveAbsenceRule`, `archiveAbsenceRules` |
| Single rule | the rule as a sentence + `Rule`, without the subject (the file names it); "Permitted" = the actor holds the flag | `cannotArchiveWhileOngoingRule`, `onlyPermittedCanCreateRule`; not `mayCreateRule`, `uniqueNameRule` |
| Event | `<Type><PastTense>Event` | `AbsenceArchivedEvent` |
| Domain error | `<Fact>Error`; *still* = not yet, *already* = past it | `AbsenceStillDraftError` |
| HTTP error | domain error name + `Http` | `AbsenceStillDraftHttpError` |
| Actor, flag | `<Type>Actor`, `may<Verb>…` | `AbsenceActor`, `mayEditOthersAbsences` |
| Repository find | `find<State><Type>ById`; across records `find<Type>By<Key>` | `findActiveAbsenceById`, `findAbsenceReasonByName` |
| Equality of a value | `<Type><Field>Equivalence` | `AbsenceReasonNameEquivalence` |
| View read | `get…` / `list…` | `getAbsenceById`, `listAbsences` |
| Use case, command | `<Verb><Type>Service`, `<Verb><Type>Command` | `ArchiveAbsenceService`, `ArchiveAbsenceCommand` |
| Translation | `<output>From<input>` | `absenceActorFromPermissions`, `absenceHttpErrorFromAbsenceError` |
| Permission key | the host's format | `absences:update` |
