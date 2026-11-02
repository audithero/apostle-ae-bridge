#!/bin/bash
# Apostle AE Bridge: installer for macOS (Terminal version).
# Double-click this file in Finder. It is safe to run again (to repair or
# update): your briefs, brand kits, runs and settings are kept.
# The work is done by scripts/install-core.sh (shared with the installer app);
# this wrapper adds the questions and the After Effects check.

set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Applications/Apostle AE Bridge"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\n  \033[31m✗ %s\033[0m\n\n' "$1"; printf 'Press Return to close this window.'; read -r _; exit 1; }

clear
cat <<'EOF'
  Apostle AE Bridge installer

  This will:
    1. copy Apostle AE Bridge to ~/Applications/Apostle AE Bridge
    2. set up its own copy of Node.js (nothing else on your Mac changes)
    3. install Claude Code if you don't have it
    4. add the Apostle panel to After Effects and connect Claude to it

  No password needed.

EOF
printf 'Press Return to start, or close this window to cancel. '
read -r _

bold "Checking your Mac"
[ "$(uname)" = "Darwin" ] || fail "This installer is for macOS only."
ok "macOS $(sw_vers -productVersion)"

FOUND_AE=0
for y in 2030 2029 2028 2027 2026 2025 2024; do
  if [ -d "/Applications/Adobe After Effects $y" ]; then ok "Found Adobe After Effects $y"; FOUND_AE=1; fi
done
[ $FOUND_AE = 1 ] || fail "After Effects 2024 or newer was not found in /Applications. Install it from Creative Cloud, then run this again."

if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import pty' >/dev/null 2>&1; then
  ok "python3 (for the Claude terminal inside the Apostle panel)"
else
  warn "Apple's command line tools are missing. The Claude terminal inside the Apostle panel needs them."
  warn "A macOS window may pop up asking to install them: click Install. Everything else works without them."
  xcode-select --install >/dev/null 2>&1 || true
fi

# install-core edits a prefs file After Effects rewrites on quit: AE must be closed
while pgrep -qf "MacOS/After Effects"; do
  warn "After Effects is open. Please save your work and quit it (Cmd+Q)."
  printf '  Press Return when After Effects has quit. '
  read -r _
done

bold "Installing"
mkdir -p "$HOME/Library/Logs"
LOG="$HOME/Library/Logs/apostle-install.log"
FAILED=""
VERSION=""
while IFS= read -r line; do
  case "$line" in
    "@@step "*)
      rest="${line#@@step }"; rest="${rest#* }"; state="${rest%% *}"; msg="${rest#* }"
      case "$state" in
        done) ok "$msg" ;;
        warn) warn "$msg" ;;
        fail) FAILED="$msg" ;;
        running) printf '  \033[2m… %s\033[0m\n' "$msg" ;;
      esac ;;
    "@@done "*) VERSION="${line#@@done }" ;;
  esac
done < <(/bin/bash "$SRC/scripts/install-core.sh" "$SRC" --dest "$DEST" 2>"$LOG")
[ -z "$FAILED" ] || fail "$FAILED (details: ~/Library/Logs/apostle-install.log)"
[ -n "$VERSION" ] || fail "The installer stopped unexpectedly (details: ~/Library/Logs/apostle-install.log)"

bold "Installed Apostle AE Bridge $VERSION."
cat <<EOF

  Next:

    1. Open After Effects.
    2. Window > Extensions > Apostle.
       When the top right of the panel says "claude linked", you're set.
       Keep the panel open (dock it anywhere) while Claude works.

  Then see START HERE.md, step 4, for your first session.

EOF
open "$DEST"
printf 'Press Return to close this window. '
read -r _
