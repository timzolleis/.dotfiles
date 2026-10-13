# personal scripts
export PATH="$HOME/.local/bin:$PATH"

# tmt completion (script comes from the installed binary)
command -v tmt >/dev/null && eval "$(tmt __zsh)"

# fnm
FNM_PATH="/opt/homebrew/opt/fnm/bin"
if [ -d "$FNM_PATH" ]; then
  eval "$(fnm env --shell zsh)"
fi

# pnpm
export PNPM_HOME="/Users/tim/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME/bin:"*) ;;
  *) export PATH="$PNPM_HOME/bin:$PATH" ;;
esac
# pnpm end


