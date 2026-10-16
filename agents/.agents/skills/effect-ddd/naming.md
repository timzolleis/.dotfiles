# Naming

Names are truthful and greppable: the name alone says what a thing is or does, without its arguments, its return type, or the surrounding code filling the gap, and a search for it finds only it.

- Name the subject: `findActiveAbsenceById`, `publishAbsenceEvent`. `findById`, `publish`, `execute` match thousands of lines.
- An action starts with its verb: `archiveAbsence`, `generateAbsenceId`.
- A translation names its output and its input: `absenceVisibilityFromReader(reader)`, `absenceActorFromPermissions(…)`, `dateTimeUtcFromDate(date)`. `visibilityFor(reader)`, `mapTo`, `toHttpError`, `absenceFrom(row)` each leave one side to the arguments or the return type.
- Variables too: `absenceBeforeUpdate`, `previousPeriod`; not `before`, `prev`, `data`, `result`.
- Files are kebab-case (`absence-policy.ts`); identifiers are camelCase / PascalCase.

| Thing | Pattern | Example |
|---|---|---|
| State | `<Phase><Type>` | `DraftAbsence` |
| States a transition accepts | what they allow | `EditableAbsence` |
| Transition, its input | `<verb><Type>`, `<Verb><Type>Input` | `archiveAbsence`, `ArchiveAbsenceInput` |
| Policy type, list | `<Verb><Type>Policy`, `<verb><Type>Policies` | `ArchiveAbsencePolicy`, `archiveAbsencePolicies` |
| Single policy | the rule as a sentence + `Policy`, without the subject (the file names it); "Permitted" = the actor holds the flag | `cannotArchiveWhileOngoingPolicy` |
| Event | `<Type><PastTense>Event` | `AbsenceArchivedEvent` |
| Domain error | `<Fact>Error`; *still* = not yet, *already* = past it | `AbsenceStillDraftError` |
| HTTP error | domain error name + `Http` | `AbsenceStillDraftHttpError` |
| Actor, flag | `<Type>Actor`, `may<Verb>…` | `AbsenceActor`, `mayEditOthersAbsences` |
| Repository find | `find<State><Type>ById` | `findActiveAbsenceById` |
| View read | `get…` / `list…` | `getAbsenceById`, `listAbsences` |
| Use case, command | `<Verb><Type>Service`, `<Verb><Type>Command` | `ArchiveAbsenceService`, `ArchiveAbsenceCommand` |
| Translation | `<output>From<input>` | `absenceActorFromPermissions`, `absenceHttpErrorFromAbsenceError` |
| Permission key | the host's format | `absences:update` |
