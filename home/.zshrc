
# fnm
FNM_PATH="/Users/tim/Library/Application Support/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="/Users/tim/Library/Application Support/fnm:$PATH"
  eval "`fnm env`"
fi

# pnpm
export PNPM_HOME="/Users/tim/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end


 gdone() {
    local target="${1:-main}"
    local branch=$(git branch --show-current)
    if [ "$branch" = "$target" ]; then
      echo "Already on $target"
      git pull --prune
    else
      git checkout "$target" && git pull --prune && git branch -D "$branch"
    fi
  }
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

# bun completions
[ -s "/Users/tim/.bun/_bun" ] && source "/Users/tim/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# nub
export PATH="$HOME/.nub/bin:$PATH"

# Pi
export PATH="/Users/tim/Library/Application Support/fnm/node-versions/v24.11.1/installation/bin:$PATH"
