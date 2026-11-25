#!/bin/sh
# T3 Code owns worktrees: a subagent works in the session's checkout, not in its own .claude/worktrees copy.
isolation=$(jq -r '.tool_input.isolation // empty')
if [ "$isolation" = "worktree" ]; then
  echo "Worktree isolation is off: T3 Code manages worktrees. Run the subagent again without isolation, in the current checkout." >&2
  exit 2
fi
exit 0
