# .dotfiles

Personal macOS setup: pi agent config, Claude/agents skills, zsh, git, and Homebrew packages. Managed with GNU Stow.

## Fresh machine

```bash
git clone git@github.com:timzolleis/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./dot init
```

Then: run `pi` (reinstalls its packages from `settings.json`, then `/login`), `gh auth login`, and `exec zsh`.

## Layout

```
dot              # CLI: init | stow | doctor | update | brew-dump
packages/bundle  # Brewfile
home/            # mirrored to ~ via `stow --no-folding`
  .zshrc
  .gitconfig
  .pi/agent/     # AGENTS.md (pi harness), settings.json, plannotator.json, extensions/
  .agents/       # AGENTS.md (global conventions), skills/ (source of truth)
```

## How it works

- `stow --no-folding` symlinks **individual files** from `home/` into `~`. Runtime dirs (`~/.pi/agent/sessions`, `npm/`, `auth.json`, …) stay as real files outside the repo — secrets structurally can't end up here.
- `dot stow` also maintains links stow can't express: `~/.pi/agent/APPEND_SYSTEM.md → ~/.agents/AGENTS.md` and `~/.pi/agent/skills/* → ~/.agents/skills/*`.
- pi's extensions from npm/git (plannotator, pi-web-access, …) are **not** checked in — `home/.pi/agent/settings.json`'s `packages` list is the manifest; pi reinstalls them on first run. Same for the `plannotator-*` skills.
- `dot doctor` verifies tools, symlink health, and fails if any secret/runtime file is ever tracked by git.

## Day to day

```bash
dot stow       # after adding/moving files in home/
dot brew-dump  # after installing new brew packages
dot update     # pull + brew bundle + restow
dot doctor     # when something feels off
```
