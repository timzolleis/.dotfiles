---
name: herdr
description: "Control Herdr panes, tabs, workspaces, commands, dev servers, other background processes, and agents. Use for subagents when the user or another skill explicitly asks for or requires them. Requires HERDR_ENV=1."
---

# Herdr

Herdr organizes terminals into workspaces, tabs, and panes, detects coding agents in panes, and exposes the current session through the `herdr` CLI.

Before any control command:

```bash
test "${HERDR_ENV:-}" = 1
```

If it fails, say you are not running inside Herdr and stop.

## CLI

The installed binary owns the syntax. Run `herdr --help`, then a group without a subcommand (`herdr agent`, `herdr pane`, `herdr workspace`, `herdr tab`, `herdr worktree`, …) to list its commands. Bare `herdr` launches the TUI; never run it. Never probe a mutating nested command by omitting arguments: `herdr workspace create` runs with defaults.

Commands return JSON. Take IDs and state from responses, never predict them. Chain steps in one bash call and pipe through `jq` to keep only the fields you need. Server errors are JSON on stderr with exit 1; syntax errors exit 2.

## Panes, agents, IDs

- Pane commands control raw terminals: shells, tests, servers. Agent commands control the recognized agent in a pane and report `idle`, `working`, `blocked`, `done`, or `unknown`.
- `idle` and `done` mean ready for input. `blocked` means an approval or question UI. `unknown` is unclassified and does not prove completion.
- IDs are opaque (`w1`, `w1:t1`, `w1:p1`) and never reused. After `pane move`, use `.result.move_result.pane.pane_id` or the agent name.
- Agent commands take a live agent name (`[a-z][a-z0-9_-]{0,31}`, unique) or the pane ID hosting it. The name clears when the agent exits.
- Your pane is `$HERDR_PANE_ID` (also `$HERDR_TAB_ID`, `$HERDR_WORKSPACE_ID`). Target it with `--current`; commands without a target may hit the UI-focused pane, which can be the user's.
- New IDs: `workspace create` → `.result.workspace`, `.result.tab`, `.result.root_pane`; `tab create` → `.result.tab`, `.result.root_pane`; `pane split` → `.result.pane`.

## Start and prompt an agent

Use a sibling pane in the current tab and `$PWD`; create a workspace, tab, worktree, or other cwd only when the user asks. Honor a requested direction; otherwise check `herdr pane layout --pane "$HERDR_PANE_ID"` and split a wide pane right, a narrow or tall one down. Avoid repeated same-direction splits.

```bash
p=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r .result.pane.pane_id)
herdr agent start reviewer --kind pi --pane "$p"
herdr agent prompt reviewer "Review the current diff; report only actionable findings." --wait --timeout 120000
```

- `agent start` needs a pane at its shell prompt and never creates layout. Use the kind the user names, else `pi`. Native agent arguments go after `--`. `agent_not_ready` means blocked at startup: wait for idle before prompting.
- `--wait` returns at the first `idle`, `done`, or `blocked`; do not add `--until` for those. Use `agent wait <name> --until blocked` only for a state-specific wait.
- `agent_prompt_stalled` or `timeout` does not prove the prompt was lost. Inspect `agent get` and `agent read` before resending.
- `agent_blocked` or a `blocked` result: read the dialog and ask the user before answering it. UI keys: `herdr agent send-keys <name> esc`.

## Pi agents

Model and thinking are pi flags, after `--`. Pass them only when the user asks; otherwise pi uses the user's defaults.

```bash
herdr agent start reviewer --kind pi --pane "$p" -- --model claude-sonnet-5-5 --thinking high --name reviewer
```

- `--model` takes an ID or pattern, optionally `provider/id`; `--model sonnet:high` sets both. `pi --list-models [search]` lists models.
- `--thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- `--name` names pi's session; reuse the Herdr agent name.
- Pi never reports `blocked`. A question ends its turn with `done`; read the reply before prompting again.

Read pi's reply from its session file, not the screen:

```bash
session=$(herdr agent get reviewer | jq -r .result.agent.agent_session.value)
jq -rs '[.[] | select(.message.role == "assistant")] | last | .message.content[] | select(.type == "text") | .text' "$session"
```

## Commands in another pane

```bash
p=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r .result.pane.pane_id)
herdr pane run "$p" "just test"
herdr pane wait-output "$p" --match "test result" --timeout 120000
herdr pane read "$p" --source recent-unwrapped --lines 120
```

- `wait-output` also matches output that already exists. `--regex` takes a Rust regex. Without `--timeout` it waits forever.
- Sources: `visible` (viewport), `recent` (soft-wrapped), `recent-unwrapped` (logs, transcripts), `detection` (agent-detection snapshot). Add `--format ansi` when colors are evidence.
- When a non-pi agent's reply does not fit in a larger read, ask it to write the reply to a temp Markdown file and answer with the path. Fallback only.

## Safety

- Use `--no-focus` unless the user asked to switch context.
- Target with `--current`, an explicit pane ID, or a unique agent name, never another client's focus.
- Close only workspaces, tabs, panes, and sessions you created, unless the user asks. Never add `--group` to bypass `workspace_group_close_required`.
- Use `--trust-repository` only after the user verified the repository; never as a retry.
- Check `herdr status` before relying on new server features. A missing method is not permission to stop or upgrade the server.
- Never run `herdr server stop` or kill the Herdr process unless the user intends it. Experiment in a named test session.

## Other machines

Before any `herdr --machine` command or `herdr machine` profile change, read [references/remote-machines.md](references/remote-machines.md).
