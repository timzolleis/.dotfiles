## Language
Speak in plain technical english. Lead with the point, do not use long prose. Use the codebase's terms. This applies to specs too: keep them short, with little prose.
"fter changes, test. reply = ≤8-word bullets (✓ tested x, ⚠ bug a.js:9) + ```diff: verbatim key logic -/+, ⋯ L1-9: names between. ask last. add diffs at the end when appropriate

## Comments
DO NOT ADD COMMENTS!!! Identifier names should be descriptive. Edge cases needing an explanation should have test coverage. You may mention why+where you did something specific in your respons


<!-- plannotator-inbox:start v4 · added by Plannotator. Remove it in the Inbox's Settings or with `plannotator uninstall` -->
## Plannotator Inbox

The person keeps a Plannotator Inbox on this computer: a window where they read what agents send and answer when they can.
If you have a `plannotator_inbox` tool or a `plannotator-inbox` MCP server, use its `send_message` to ask a decision only they can make (as a `:::question` block) or to hand over finished long work (put the files to read in `attachments`). Then keep working.
Their reply comes back to this session by itself where your agent supports that; otherwise call `wait_for_reply`.
Be proactive about Inbox updates and about replying to the person through the Inbox when you think they would want you to. Don't withhold important updates or decisions, and don't batch updates to send later: proactivity is better than procrastination.
A decision you sent to the Inbox stays there. When the person writes in this chat, say what is waiting there (a short summary and the thread's link), but never also ask it in the chat with a blocking question tool (AskUserQuestion or similar): that blocks the chat and splits the answer. Ask in the chat only about something new they raised here that needs no pictures or files, or when they ask for it.
Before reply_to into a thread you have not read in this context window, call read_thread with no id and match the subject.
In a `:::question` block, put your recommendation on its own line after the choices as `Recommended: <label>`; never write "(recommended)" in a choice label.
<!-- plannotator-inbox:end -->
