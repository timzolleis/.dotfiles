---
name: herdr
description: "Control the Herdr app's spaces, tabs and panes and its herdr-core (`hc`) terminals: commands, dev servers, other background processes, and agents. Use for subagents when the user or another skill explicitly asks for or requires them. Requires HC_TERMINAL_ID."
---

# Herdr

Herdr is a desktop app: spaces hold tabs, tabs hold panes. Every pane shows a terminal run by herdr-core, whose CLI is `hc`. `hc` starts, reads, messages, waits on and ends terminals; `herdr-app` changes only what the person sees. The old terminal multiplexer `herdr` (`herdr pane …`, `HERDR_ENV`, `HERDR_PANE_ID`) is gone: never call it.

Before any control command:

```bash
test -n "${HC_TERMINAL_ID:-}"
```

If it fails, say you are not running in a herdr-core terminal and stop.

## Manuals

The installed binaries own the syntax. Read `hc --skill` before driving terminals and `herdr-app --skill` before changing the window; `hc <command> --help` and `herdr-app commands` list exact arguments. Never launch bare `hc` or `herdr-app`: both open something interactive.

## The model

| Thing | Is | Rule |
|---|---|---|
| Space | one work stream: a branch, a story | named after its task; one per stream, never per agent |
| Worktree | a checkout of one branch | only agents that write code get one; reviewers share the checkout |
| Slice | a worktree of a stream's sub-branch `<branch>--<slice>` (a stacked PR) | no space of its own: its agent's tab sits in the stream's space |
| Tab | one agent, named after its job | a space starts with one tab, its orchestrator's; a reviewer set shares one tab |
| Pane | one terminal | never split an agent into another agent's tab |
| Background terminal | setup, dev server | hidden (no `herdr.space` label); the status bar shows and peeks them |

Never change the person's view (`layout.*`, `space.select`, `tab.select`, focus) unless they ask: they work in this window. A screenshot that needs another view switches, shoots and switches back in one command.

The person's own mods are the `-plus` ones in `~/.config/herdr-app/mods`, with the layout `layouts/tim.json`. Edit them there: Herdr reloads only real files there, never through a symlink. After a change, `~/.dotfiles/dot herdr save` copies them into the dotfiles.

## Codemode tools

In pi, the codemode namespace `herdr` wraps the commands below; prefer it when present. `describeNamespace("herdr")` lists its tools and arguments. `workspace` is a space id; `pane` and `rootPane` are terminal addresses (`t7`). Agents launched with it report back as a message that starts your turn: never wait on, poll, or read them.

- Delegate: `tools.subagent_launch({ name, cwd, prompt, task, role })`. It opens a new tab named after the agent in your space (`tab` groups a set, which reports in one message). `task` (default the brief's first line) and `role` (`impl` | `review`) show in the agents list. Add `model` and `thinking` only when the user names them; sub-agents default to `thinking: medium`.
- Scope each brief to about 50 turns of work, one slice or one review lens. Agents that run 130+ turns carry 300k+ of context and cost $10-20 each; they compact themselves at 200k, which still loses detail. Split by slice, hand over through commits, and start a fresh agent for the next round.
- A finished agent's terminal stays open and its tab settles (folded into `+N` in the tab bar) so the person can read it. `subagent_send({ name, text })` steers a running or finished agent. `subagent_stop` only when the user asks or the work is merged.
- A stream with its own orchestrator, when the user asks for one:

```js
const wt = await tools.worktree_create({ cwd, branch, task: "Export architecture", startPi: false });
await tools.subagent_launch({ name, cwd: wt.path, pane: wt.rootPane, orchestrator: true, prompt });
```

- `worktree_create` puts the checkout in `~/.herdr/worktrees/<repo>/<branch>`, opens it as a space with one tab, and runs setup (`ship create --bare` in a ship project, else the package install and `.env` copies) in a hidden terminal. `serve: true`, or `dev_server({ cwd })` later, starts the dev server hidden and returns its URL. Start no server of your own.
- Slices: `worktree_create({ cwd, parent: <stream branch>, branch: "api" })` makes `<parent>--api` with no space and returns `{ path, branch }`; launch the slice agent with `subagent_launch({ cwd: path, ... })`. `worktree_list({ cwd })` shows streams with their slices, dirty and merged.
- A bare worktree has `DATABASE_URL=` empty: anything that needs the database fails until `ship create <project> <branch>` upgrades it with its own clone.
- An orchestrator keeps its terminal and its tools, outlives you, and reports each time it settles; its reports show in your chat without starting a turn, except errors and exits.
- `worktree_remove({ workspace })` or `({ path })` for a slice closes the space, deletes the checkout and runs `ship down`. Only when the user asks; it refuses an unmerged slice without `force`.

## Identity

- `agent_status({ task })`: set `task` (2-6 words, a ticket title) when you take a new piece of work. The agents list shows it. `now` is optional; skip it.
- Gates for a stream (effect-ddd: the story is the plan, slices are stacked PRs): the story is designed live with the person; each slice reaches them only after a reviewer agent passed it.

## Terminals and addresses

- Your terminal is `$HC_TERMINAL_ID`. Addresses (`t7`) are never reused; names (`review`) are unique among live terminals. `hc get $HC_TERMINAL_ID` shows your labels: `herdr.space` and `herdr.tab` are the space and tab you are in.
- A terminal shows up in the window only with both labels: `hc run --bg --label herdr.space=<space> --label herdr.tab=<tab> …` adds a pane to that tab. A tab id Herdr doesn't know becomes a new tab; name it with `herdr-app do tab.rename --id <tab> --name <name>` once the app has adopted it. Unlabeled terminals stay hidden; a sub-agent without labels shows under its parent in the agents list.
- Terminals you start with `hc run` are your children and end when you end, unless `--outlive-parent`; `--no-parent` makes a plain pane. Pass `--no-notify` when you wait for the result yourself, or hc types notes about it into your input.
- `herdr-app ls` lists spaces, tabs and their terminals; use its ids rather than guessing.

## Start an agent

Run agents interactively, never in a one-shot print mode. node tools such as pi need a login shell, so start them through `zsh -lic`:

```bash
hc run --bg --no-notify --name reviewer --cwd "$PWD" \
  --label herdr.space=<space> --label herdr.tab=<tab> \
  -- zsh -lic 'exec pi "$@"' pi --name reviewer -- "Review the current diff; report only actionable findings."
```

- Model and thinking are pi flags: `--model claude-sonnet-5-5`, `--thinking high`. Pass them only when the user asks. `pi --list-models [search]` lists models.
- `--name` names pi's session; reuse the terminal name. `--session-id <uuid>` fixes the session id, so its file is `~/.pi/agent/sessions/*/*_<uuid>.jsonl`.
- pi reports its status itself (`working`, `idle`, `done`); `hc get <t>` shows it with a `turn` counter. `hc wait <t>` returns at once when the agent is not working, so a freshly started agent with a task in argv may look idle: follow `hc events --json --terminal <t>` for the next `turn` event instead, or start it without a task and use `hc send --wait <t> "<task>"`.
- `blocked` means a person is needed: read the screen and ask the user.

Read pi's reply from its session file, not the screen:

```bash
jq -rs '[.[] | select(.message.role == "assistant")] | last | .message.content[] | select(.type == "text") | .text' "$session"
```

## Commands in another terminal

```bash
t=$(hc run --bg --json --no-parent --cwd "$PWD" --label herdr.space=<space> --label herdr.tab=<tab> | jq -r .address)
hc send "$t" "just test"
hc wait "$t" --output "test result" --timeout 120
hc read "$t" --lines 120
```

- `hc run` without a command starts a login shell. `hc send` types a line and presses Enter.
- `hc wait --output X` matches plain text printed after the wait starts; read first when the line may already be on screen. It also ends on exit, error or blocked, and on its timeout (default 180 s, then wait again).
- `hc read --lines N` prints the screen plus N lines of history.
- Never sleep or poll for anything hc runs: wait with `hc wait`.

## Safety

- Changing the window (new spaces, tabs, splits, focus) only when the user asked or a tool above does it for them.
- End only terminals you started: `hc kill <t>; hc rm <t>`. `hc ls` lists every terminal of the user, not just yours.
- Never `hc server stop`, restart the core, or quit the app unless the user intends it.

## Other machines

`hc machine ls` lists machines. `hc run --on <machine> …` returns `machine/t7`: use that full address afterwards. `hc exec --on <machine> <cmd>` runs one command; `hc file read|write|edit --on <machine>` touches remote files. `herdr-app do space.new --machine <machine> --folder <path>` opens a space there. The codemode tools act on this machine only.
