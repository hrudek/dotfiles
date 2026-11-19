# dotfiles

Dotfiles for NixOS, NixOS-WSL, Ubuntu, Ubuntu-WSL, Omarchy, and a minimal native Windows
setup. `dotctl` detects the platform; there is no Nix installation path on
Ubuntu, Omarchy, or Windows.

## Bootstrap

Install Git, clone this repository as `~/dotfiles`, then run `dotctl init`. It
links `dotctl` into `~/.local/bin` and applies the required system, dotfile,
tool, and integration configuration. Every machine gets the same setup; there
are no personal/work profiles (see [Git identities](#git-identities)).

### Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/hrudek/dotfiles.git ~/dotfiles
bash ~/dotfiles/dotctl init
```

Missing packages listed in `packages/ubuntu-essential.txt` are installed, along
with Docker Engine, Compose and Buildx (see [Docker](#docker)). mise is
installed with its official installer when absent. Nix is never installed.
Zoxide is installed as a system package, and the managed Fish and Zsh configs
activate its `z` command automatically in new shell sessions.

### Ubuntu-WSL

Bootstrap exactly as on Ubuntu. Ubuntu-WSL is detected from the Ubuntu
identity plus WSL runtime markers (`WSL_DISTRO_NAME`, `/run/WSL`, or WSL
interop); Docker containers on a WSL2 host count as plain Ubuntu. It adds only
what WSL needs on top of the Ubuntu setup:

- `packages/ubuntu-wsl.txt` (currently only `xclip`, which Pi and Doom use to
  read the Windows clipboard through WSLg)
- Fish as the default login shell (takes effect in the next WSL session)
- `packages/stow-ubuntu-wsl.txt` instead of the common selection, so desktop
  configs (i3, i3status, Polybar, Rofi, Flameshot, Ghostty) are not linked;
  previously linked ones are unstowed
- the Herdr PowerShell/Git Bash cwd integration on the Windows side (see below),
  which requires WSL interop (`powershell.exe`, `wslpath`)

Other NixOS-only machine settings (locale, `GH_HOST`, ...) are not replicated.

### Omarchy

```bash
git clone https://github.com/hrudek/dotfiles.git ~/dotfiles
bash ~/dotfiles/dotctl init
```

Only missing packages from `packages/omarchy-essential.txt` are installed with
Omarchy's package command. Fish is set as the user's default login shell; the
new shell takes effect after logging out and back in. The existing system
`mise` is reused, and the shared mise declaration installs the complete
development toolset, including Pi. The Omarchy setup installs Ghostty and
applies the repository's Ghostty, Hyprland, and Omarchy shell configurations.
The shell configuration includes the custom workspace widget and top-bar
layout. `shell.json` is linked with Stow; the plugin is copied into Omarchy's
plugin directory because Omarchy plugin validation rejects symlinks. The
Hyprland setup keeps Omarchy's Wayland services and shell while
replacing its bindings and look-and-feel with the converted i3 workflow. Zoxide is installed as a system package, and the managed Fish and
Zsh configs activate its `z` command automatically in new shell sessions.
X-oriented Stow packages such as i3, i3status, Polybar, Rofi, and Flameshot are
not selected. Before Stow runs, `dotctl` removes the superseded
stock Ghostty, Git, Herdr, Hyprland, mise, Neovim, Omarchy shell, Starship,
and tmux configuration paths; managed symlinks and Herdr state files are
preserved on subsequent runs.

The Omarchy system layer also compares energy settings before changing them:
`omarchy/power-settings.conf` declares the UPower policy (20% low, 7% critical,
5% automatic protection, `CriticalPowerAction=Auto`), and `dotctl` requests that
the screensaver be disabled. Each group of differences is displayed as
current → repository and requires confirmation; declining or running without
an interactive terminal preserves the existing settings. `--yes` accepts these
prompts, while `--dry-run` only displays differences without prompting or writing.
Matching settings cause no writes or service restarts. Confirmed UPower changes
use `sudo`, create a timestamped backup of `/etc/UPower/UPower.conf`, preserve
unrelated settings, and restart UPower. The screensaver setting uses Omarchy's
persistent toggle; the five-minute lock in the Stow-managed `shell.json` is
unchanged. Run `dotctl apply --only system` to compare/apply these settings;
they also run during `init`, full `apply`, and `update`. This confirmation
behavior is specific to these energy settings, not a change to Stow handling.

### NixOS

Git may be obtained temporarily before the declarative configuration has been
applied:

```bash
nix-shell -p git --run 'git clone https://github.com/hrudek/dotfiles.git ~/dotfiles'
bash ~/dotfiles/dotctl init
```

`init` writes `/etc/nixos/configuration.nix` as a small wrapper that imports
`~/dotfiles/nix/configuration.nix`, then runs `nixos-rebuild switch`. Relative
imports such as `./packages.nix` are still resolved from the repository config,
and the normal generated hardware file remains at
`/etc/nixos/hardware-configuration.nix`.

### NixOS-WSL

```bash
nix-shell -p git --run 'git clone https://github.com/hrudek/dotfiles.git ~/dotfiles'
bash ~/dotfiles/dotctl init
```

NixOS-WSL is detected from the NixOS identity plus the same WSL runtime
markers as Ubuntu-WSL. `init` writes `/etc/nixos/configuration.nix` as a wrapper that imports
`~/dotfiles/nix/configuration.wsl.nix`, then runs `nixos-rebuild switch`; no
`/etc/nixos` symlink is needed.

### Native Windows (Git Bash)

Install Git for Windows, then start Git Bash from the already open Windows
shell. This deliberately resolves Bash relative to the installed `git.exe`, so
a WSL `bash` cannot be selected accidentally.

From PowerShell:

```powershell
& (Join-Path (Split-Path (Split-Path (Get-Command git.exe).Source)) 'bin\bash.exe') --login -i
```

Or from Command Prompt (`cmd.exe`):

```bat
powershell -NoProfile -Command "$g=Split-Path (Split-Path (Get-Command git.exe).Source); & ($g + '\bin\bash.exe') --login -i"
```

The prompt is now running Git Bash. Verify that `uname -s` starts with `MINGW`
or `MSYS`, then clone into the Windows user profile explicitly and initialize
the repository:

```bash
uname -s
WINDOWS_HOME="$(cygpath -u "$USERPROFILE")"
cd "$WINDOWS_HOME"
git clone https://github.com/hrudek/dotfiles.git dotfiles
bash "$WINDOWS_HOME/dotfiles/dotctl" init
```

On native Windows, `dotctl` exports `HOME="$(cygpath -u "$USERPROFILE")"`
before resolving its configuration paths. This also gives child processes,
including integration tools, the same home. If the inherited `HOME` differs,
`dotctl` reports the home it uses. An explicit `XDG_CONFIG_HOME` is still
respected. Linux and WSL are unaffected.

On native Windows, `init`, `apply`, and `update` also check the persistent
Windows user variable `HOME` and set it to `USERPROFILE` if needed (not
system-wide). Any change is reported. `--dry-run` only previews this step;
read-only commands such as `doctor` never persist it. Sign out of Windows and
back in, or reboot, so new shells inherit the setting. Existing shells are
unchanged. No files are migrated from the old home; copy any needed SSH keys
or configuration yourself before switching.

Windows setup is user-local and does not request administrator rights. If Git
Bash is already running elevated, `dotctl` explicitly permits Scoop's
`-RunAsAdmin` mode while retaining the current user's default Scoop directory
under `%USERPROFILE%`. `dotctl` installs Scoop when absent, updates it, installs
mise through Scoop, installs native prerequisites such as GCC from
`packages/windows-scoop.txt`, and uses `windows/mise.toml` for the minimal
Windows toolset: Node.js, Neovim, Tree-sitter, ripgrep, fd, fzf, zoxide,
Lazygit, Pi, Claude Code, Codex, GitHub Copilot CLI, and Herdr. This
tool configuration is copied to mise's global user config so its shims resolve
the managed tools outside the repository as well. `dotctl` activates zoxide in
Git Bash and PowerShell, making its `z` navigation command available in new
shell sessions. The Windows mise environment selects Scoop's GCC toolchain for
native builds, including Tree-sitter parsers, instead of unavailable MSVC Build
Tools.

Windows does not use Stow or symlinks. The shared Agents, Pi, and Herdr trees are
copied into the corresponding directories below the user profile; Neovim is
copied to `%LOCALAPPDATA%/nvim`. Repository files overwrite older copies, while
unmanaged authentication and session files remain in place. The shared Herdr
configuration is copied unchanged. Bindings and scheduled commands belonging to
Linux-only plugins may therefore fail on Windows; only the Windows plugin list
in `packages/herdr-plugins-windows.txt` is installed.

Scoop installation can still be blocked by corporate PowerShell policy, proxy,
or application-control rules. In that case `dotctl` stops without attempting to
elevate privileges. `-RunAsAdmin` only acknowledges an already elevated shell;
it does not turn the user-local installation into a system-wide installation.

### PATH after bootstrap

`init` creates `~/.local/bin/dotctl`. On Linux this is a symlink; on Windows it
is a Git Bash launcher. Fish configuration in this repository adds that
directory automatically. For the current Bash/Zsh/Git Bash session, or if your
login profile does not already add it, run:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then start a new shell or add that export to the machine's login profile.
`dotctl link` warns when the directory is not currently on `PATH`, and
`dotctl doctor` checks it. On Windows, `dotctl` activates mise in both Git Bash
and the current user's Windows PowerShell profile and adds mise's shim directory
to the Windows user `PATH`. New shells can therefore run managed commands such
as `nvim`, `pi`, and `claude` directly. `dotctl` also installs a `gitbash.cmd`
launcher on the Windows user `PATH`, so entering `gitbash` in PowerShell or
Command Prompt opens an interactive Git Bash login shell with the expected
`MINGW64` environment.

When native Windows setup detects an installed WSL distribution, or when
`dotctl` runs inside NixOS-WSL or Ubuntu-WSL, it installs opt-in PowerShell and Git Bash
prompt integration for Herdr. From Fish inside WSL, both `powershell.exe` and
its shorter alias `winps` start a marked interop session and pass the calling
distribution name. The Windows prompts report drive paths such as `C:\\src` to
the WSL Herdr server as `/mnt/c/src`. Running `gitbash` from that PowerShell
keeps reporting directory changes because the marker is inherited by the child
shell. Native PowerShell and Git Bash sessions remain unchanged. Common drive
paths are converted without starting `wsl.exe`; unusual paths use `wslpath`
only after the working directory changes. Fish-specific WSL workarounds and
interoperability helpers are kept together in
`~/.config/fish/conf.d/wsl.fish`; Fish loads that file automatically and its
early guard leaves non-WSL systems unchanged.

## Docker

The system layer (`init`, `apply --only system`, full `apply`, and `update`)
installs Docker on Linux:

- Ubuntu and Ubuntu-WSL use Docker's official signed APT repository for
  `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-compose-plugin`, and
  `docker-buildx-plugin`. Only missing packages are installed. Unsupported
  Ubuntu releases fail before adding a repository. Existing Docker APT sources
  are reused. Conflicting distro packages (such as `docker.io`, `containerd`,
  or `podman-docker`) are reported, never automatically removed or replaced;
  migrate them manually first. An unmanaged Docker CLI is also left untouched.
- An existing Docker Desktop WSL integration is preserved without installing
  or starting a second engine. Docker Desktop is not required for native WSL
  Docker, and is not installed by the native Windows setup.
- Omarchy installs `docker`, `docker-compose`, and `docker-buildx` from its
  system packages. NixOS and NixOS-WSL enable Docker declaratively.

On Ubuntu and Omarchy the local Docker service is enabled and started when
systemd is running. Without systemd, installation succeeds with instructions
for starting the daemon; on WSL, enable `[boot] systemd=true` in `/etc/wsl.conf`
and restart the distribution. No Docker daemon configuration is overwritten.

Adding the current user to `docker` grants **root-equivalent access** and
requires confirmation on Ubuntu and Omarchy. `--yes` accepts it; noninteractive
runs without `--yes` keep membership unchanged (use `sudo docker`). Log out and
back in after joining the group. NixOS-WSL retains its existing declarative
`hrudek` group membership; bare-metal NixOS does not grant it automatically.
`--dry-run` prints planned actions without changing packages, services, or groups.

`dotctl doctor` checks the CLI, Compose, Buildx, and daemon access as the current
user. It reports permission problems and stopped/unreachable daemons without
changing anything. To check a privileged local installation without joining the
group, run `sudo docker info` yourself.

## Git identities

Both Git identities are linked on every Linux machine from
`stow/gitconfig/.config/git/` (native Windows keeps its own Git for Windows
configuration and is not managed):

- `config` holds the shared settings and the personal identity, which is the
  default everywhere
- `work_config` holds the work identity and is included via
  `includeIf "gitdir:~/code/work/"`, so it applies automatically to every
  repository (and worktree) below `~/code/work/`

Keep work repositories below `~/code/work/` and everything else elsewhere (e.g.
`~/code/`). GitHub and the company GitHub Enterprise authenticate through `gh`,
so no credential manager or password store is needed. `dotctl` logs `gh` in to
github.com; for work repositories, also run
`gh auth login --hostname siempelkamp.ghe.com` once (`dotctl doctor` warns
while that login is missing).
Machine-local Git settings belong in `~/.gitconfig.local`, which is included
last. Do not keep a regular `~/.gitconfig`: Git reads it after
`~/.config/git/config`, so it would override the identities (`dotctl doctor`
warns about it). Links from the former `~/.gitconfig`/`~/.gitconfig.profile`
layout are removed automatically.

The work-only agent skills in `stow/agents-work` (e.g. `ad-query`) are linked
on every machine as well; they fail cleanly where the company network is not
reachable.

Claude Code only reads skills from `~/.claude/skills`, a directory it also
writes to itself. `dotctl stow` therefore links each shared skill there
individually (`~/.claude/skills/<name>` → `~/.agents/skills/<name>`) and removes
links to skills that were deleted; native Windows gets copies instead.

The rest of the Claude Code setup mirrors Pi. `stow/claude` links
`CLAUDE.md` (imports the shared `~/.pi/agent/AGENTS.md`), `keybindings.json`,
the Catppuccin Macchiato theme in `themes/` and `statusline.sh`, which shows
Claude subscription usage. Claude Code rewrites `settings.json` itself, so
`dotctl apply --only integrations` merges the managed keys from
`packages/claude-settings.json` into it with `jq` (theme, status line,
experimental Code Mode). It also adds the `executor` MCP server at user scope.

Azure DevOps over HTTPS is not configured. In the rare case it is still needed
from WSL, use Windows Git, which ships Git Credential Manager and signs in with
the company SSO in the browser:

```bash
git.exe clone https://dev.azure.com/<org>/<project>/_git/<repo>
```

### Migrating from dotctl < 0.4

Earlier versions selected a `personal` or `work` profile. `dotctl init
--profile ...` still works but ignores the option, and
`~/.config/dotctl/config` is no longer read (`dotctl doctor` points it out; it
can be deleted). On former work machines, dotctl no longer manages Git
Credential Manager, the GPG key, or `pass`; nothing is removed automatically.
If they are not used otherwise, clean up manually: `pass rm -r git` removes the
stored Git credentials, and on Ubuntu `sudo apt-get remove gcm` removes the Git
Credential Manager package.

Stow simulates changes before applying them and never uses `--adopt`.

Applications that write next to their configuration (Fish, Git, Herdr, Pi)
are listed in `packages/stow-no-folding.txt` and linked file by file
(`stow --no-folding`) into real directories. Their logs, sockets, sessions,
credentials, and plugin checkouts therefore stay in `$HOME` and never end up
in the repository; only the files tracked here are links. Other packages may
still be folded into a single directory link. If such a directory was folded
by an earlier dotctl version, `dotctl stow` moves it out of the repository
(including the runtime state written through the link) and relinks the
tracked files; `dotctl doctor` reports folded directories.

## Commands

```text
dotctl init
dotctl apply [--only system|dotfiles|tools|integrations]
dotctl update
dotctl doctor
dotctl stow
dotctl link
dotctl help
dotctl version
```

Global flags may appear before or after the command:

- `--dry-run` prints mutating commands without running them
- `--yes`, `-y` accepts prompts
- `--verbose`, `-v` prints commands
- `--no-color` disables color

`apply` converges either the complete setup or a selected layer without pulling
the repository. GitHub authentication may open an interactive login; for
non-interactive use, authenticate beforehand or provide `GH_TOKEN`.

`update` fast-forwards the repository when clean, reapplies the setup, refreshes
managed tools and integrations, and runs `doctor`. If the repository has
uncommitted changes, it warns and skips the pull, but updates software using
the current checkout. A clean repository with a detached HEAD or no upstream
still cannot be pulled.

`doctor` performs read-only checks of the current installation.

## Managed tools and integrations

Portable Linux development tools, including `direnv`, are declared in
`stow/mise/.config/mise/config.toml`. Fish and Zsh load the direnv shell hook;
project `.envrc` files still require an explicit `direnv allow`. NixOS retains
its system-level direnv/nix-direnv integration as well. The minimal native Windows toolset is in
`windows/mise.toml`. On Linux, `dotctl` installs mise from `mise.run` into
`~/.local/bin` and uses `mise self-update`. On Windows, Scoop installs and
updates mise and native Windows prerequisites such as GCC, while `dotctl`
copies the Windows mise declaration to the global config shared by Git Bash and
PowerShell. Platform prerequisites live under `nix/`, `windows/`, and `packages/`.
Omarchy uses `packages/stow-omarchy.txt` and Ubuntu-WSL
`packages/stow-ubuntu-wsl.txt` instead of the desktop-oriented common Stow
selection; common packages a platform does not select are unstowed.

Integration and plugin sources are also declared in `packages/`. `dotctl`
installs and updates them idempotently as part of the normal apply flow.
This includes Pi packages from `packages/pi-packages.txt` (for example the
`pi-web-access` web search), which `dotctl` installs with `pi install` into
`~/.pi/agent/settings.json`; `dotctl doctor` reports missing ones. Optional
web search API keys belong in the untracked `~/.pi/agent/web-search.json`.

Pi extensions with a `package.json` under `stow/pi/.pi/agent/extensions/`
carry a committed `package-lock.json`. On Linux, the integrations layer runs
the mise task `pi:extensions`, which uses mise's Node.js to run `npm ci` in
each of these extensions. Their `node_modules` directories are gitignored.
`dotctl doctor` reports extensions whose dependencies are missing. To typecheck
and test all extensions, run:

```bash
mise run --cd ~/dotfiles pi:extensions:check
```
