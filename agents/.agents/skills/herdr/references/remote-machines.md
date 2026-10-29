# Remote machines

IDs and live agent names are scoped to one server. Two saved SSH machines can both have `w1:p1` or an agent named `reviewer`. Selecting a machine in the TUI does not retarget commands in your pane: without `--machine`, they use the inherited session and socket.

Use the same global prefix for discovery and every later command:

```bash
herdr --machine <label-or-id> agent list
herdr --machine <label-or-id> pane list
herdr --machine <label-or-id> agent prompt <remote-agent-name> "Reply with your current status." --wait --timeout 120000
```

- The selector is an enabled saved profile ID or a unique, case-sensitive label, not an SSH hostname.
- Do not combine `--machine` with `--session` or `--remote`.
- Discover IDs on that machine; local IDs and `--current` do not identify remote panes.
- Remote worktree paths must be absolute, `~`, or start with `~/`; plugin link paths must be absolute.
- Forwarding never installs, starts, or restarts the remote server and never falls back to Local. Local configuration, session management, installation, and interactive attachment are not forwarded.
- A connection failure does not prove a mutation was not applied: inspect remote state before retrying.

## Profiles

- `herdr machine list [--json]` lists saved profiles, not remote panes.
- Add, remove, enable, or disable profiles only when the user asks. Removing a profile disconnects the client; remote sessions keep running.
- Non-interactive `machine add` uses the remote default session unless `--remote-session` is given.
- Diagnose with `herdr machine status [<label-or-id>] --json`.
- `herdr machine reconnect` needs the user to complete SSH authentication; do not run it for them.
- Setup asks before stopping an incompatible server and defaults to No; do not approve replacement without the user's consent.
