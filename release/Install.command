#!/bin/bash
# Apostle AE Bridge: installer for macOS.
# Double-click this file in Finder. It is safe to run again (to repair or
# update): your briefs, runs and settings in the install folder are kept.

set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Applications/Apostle AE Bridge"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:$PATH"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\n  \033[31m✗ %s\033[0m\n\n' "$1"; printf 'Press Return to close this window.'; read -r _; exit 1; }
ask()  { local a; printf '  %s [y/N] ' "$1"; read -r a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

clear
cat <<'EOF'
  Apostle AE Bridge installer

  This will:
    1. check your Mac has After Effects, Node.js and Claude Code
    2. copy the bridge to ~/Applications/Apostle AE Bridge
    3. add two panels to After Effects (it asks for your Mac password once)
    4. connect Claude Code to After Effects

EOF
printf 'Press Return to start, or close this window to cancel. '
read -r _

# ---------------------------------------------------------------- 1. checks
bold "1. Checking your Mac"

[ "$(uname)" = "Darwin" ] || fail "This installer is for macOS only."
ok "macOS $(sw_vers -productVersion)"

AE_DIRS=()
for y in 2030 2029 2028 2027 2026 2025 2024; do
  [ -d "/Applications/Adobe After Effects $y" ] && AE_DIRS+=("/Applications/Adobe After Effects $y")
done
[ ${#AE_DIRS[@]} -gt 0 ] || fail "After Effects 2024 or newer was not found in /Applications. Install it from Creative Cloud, then run this again."
for d in "${AE_DIRS[@]}"; do ok "Found $(basename "$d")"; done

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  warn "Node.js is not installed. The bridge needs it."
  if command -v brew >/dev/null && ask "Install Node.js with Homebrew now?"; then
    brew install node || fail "Homebrew could not install Node.js."
    NODE="$(command -v node || true)"
  else
    open "https://nodejs.org/en/download"
    fail "Install the LTS version of Node.js from the page that just opened (the macOS Installer .pkg), then double-click Install.command again."
  fi
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js $("$NODE" -v) is too old. Install the LTS version from https://nodejs.org, then run this again."
ok "Node.js $("$NODE" -v) ($NODE)"

if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import pty' >/dev/null 2>&1; then
  ok "python3 (for the Claude terminal inside the Apostle panel)"
else
  warn "Apple's command line tools are missing. The Claude terminal inside the Apostle panel needs them."
  warn "A macOS window may pop up asking to install them: click Install. Everything else works without them."
  xcode-select --install >/dev/null 2>&1 || true
fi

CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  warn "Claude Code is not installed."
  if ask "Install Claude Code now (official installer from claude.ai)?"; then
    curl -fsSL https://claude.ai/install.sh | bash || fail "The Claude Code installer failed. See https://docs.claude.com/en/docs/claude-code/setup"
    CLAUDE="$(command -v claude || ls "$HOME/.local/bin/claude" 2>/dev/null || true)"
  fi
  [ -n "$CLAUDE" ] || fail "Claude Code is required. Install it (https://docs.claude.com/en/docs/claude-code/setup), then run this again."
fi
ok "Claude Code ($CLAUDE)"

# ------------------------------------------------------ AE must be closed
while pgrep -qf "MacOS/After Effects"; do
  warn "After Effects is open. Please save your work and quit it (Cmd+Q)."
  printf '  Press Return when After Effects has quit. '
  read -r _
done

# ---------------------------------------------------------------- 2. copy
bold "2. Copying the bridge to $DEST"
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  # no --delete: keep anything the user made in the install folder
  rsync -a --exclude ".apostle-runs/" --exclude ".env" "$SRC/" "$DEST/" || fail "Could not copy files to $DEST."
fi
# files from a downloaded zip are quarantined; After Effects won't load a
# quarantined panel
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
chmod +x "$DEST"/*.command "$DEST"/scripts/*.sh 2>/dev/null || true
ok "Copied"

SMOKE="$("$NODE" -e '
const { spawn } = require("child_process");
const p = spawn(process.argv[1], [process.argv[2]], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
p.stderr.on("data", d => out += d); p.stdout.on("data", d => out += d);
setTimeout(() => { p.kill(); console.log(/running/.test(out) ? "ok" : out.slice(0, 400)); }, 2500);
' "$NODE" "$DEST/build/index.js")"
[ "$SMOKE" = "ok" ] || fail "The bridge server did not start: $SMOKE"
ok "Bridge server starts"

# ---------------------------------------------------------------- 3. panels
bold "3. Adding the panels to After Effects"
echo "  The MCP Bridge panel goes inside the After Effects app folder, which needs"
echo "  your Mac login password. Nothing shows on screen while you type it; press"
echo "  Return when done."
for d in "${AE_DIRS[@]}"; do
  sudo mkdir -p "$d/Scripts/ScriptUI Panels" &&
  sudo cp "$DEST/build/scripts/mcp-bridge-auto.jsx" "$d/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx" ||
    fail "Could not copy the MCP Bridge panel into $d."
  ok "MCP Bridge panel -> $(basename "$d")"
done

CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$CEP_DIR"
rm -rf "$CEP_DIR/apostle-panel"
ln -s "$DEST/apostle-panel" "$CEP_DIR/apostle-panel" || fail "Could not install the Apostle panel."
# the Apostle panel is unsigned, so CEP's debug mode must allow it
for V in 11 12 13 14; do defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1; done
ok "Apostle panel (Window > Extensions > Apostle)"

mkdir -p "$HOME/Documents/ae-mcp-bridge"
ok "Bridge folder ~/Documents/ae-mcp-bridge"

# ---------------------------------------------------------------- 4. claude
bold "4. Connecting Claude Code to After Effects"
"$CLAUDE" mcp remove -s user AfterEffectsMCP >/dev/null 2>&1 || true
"$CLAUDE" mcp add -s user AfterEffectsMCP -- "$NODE" "$DEST/build/index.js" >/dev/null ||
  fail "Could not register the bridge with Claude Code."
ok "Claude Code now has the AfterEffectsMCP tools"

# ---------------------------------------------------------------- done
bold "Installed."
cat <<EOF

  Next (also in START HERE.md, steps 3 to 6):

    1. Open After Effects.
    2. After Effects > Settings > Scripting & Expressions:
       tick "Allow Scripts to Write Files and Access Network".
    3. Window > mcp-bridge-auto.jsx  (keep this little panel open,
       with "Auto-run commands" ticked).
    4. Window > Extensions > Apostle  (optional, the Apostle panel).
    5. Double-click "Check Setup.command" in
       $DEST
       to confirm everything is connected.

EOF
open "$DEST"
printf 'Press Return to close this window. '
read -r _
