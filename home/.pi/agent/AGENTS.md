## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms. This applies to specs too: keep them short, with little prose.


## Call trees

A **call tree** is the one format for a call path, in discussion and in specs:

```text
  AnnouncementService.publishAnnouncement(args)
  ├─ AnnouncementRepository.findAnnouncementById(organizationId, announcementId) → Effect.Effect<Announcement, AnnouncementNotFoundError>
- ├─ AnnouncementRepository.updateAnnouncement(changes)
+ ├─ AnnouncementRepository.publishAnnouncement(draft, by) → AnnouncementNotDraftError
  └─ EventClient.publish(AnnouncementPublishedEvent)
```

- The root is the entry point; each line is one call as `Owner.method(args)`, indented under its caller with `├─`, `└─`, and `│`.
- Mark a decision, effect, or typed failure inline after `→`; put the branch's calls under it.
- When showing current versus proposed, prefix removed lines with `-`, added lines with `+`, unchanged lines with a space, and show only the subtree that changes.
- Name owners with the codebase's identifiers so each line greps to its definition.
## References


- Looking up an Effect API: read the project's installed `effect` source first. When it does not answer, read `~/.local/share/effect-repos/effect-v4` (tracks `main`; start at `LLMS.md` and `ai-docs/src`). Read `effect-v3` (branch `v3`) only when the installed `effect` major is 3.
