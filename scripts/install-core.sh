#!/bin/bash
# Install (or repair, or update) Apostle AE Bridge from a release folder.
# The single source of truth for installing: the native installer app runs it
# as a child process, and release/Install.command wraps it for Terminal.
#
#   install-core.sh <payload-dir> [--dest DIR]
#
# Non-interactive: no sudo, no prompts, never reads stdin. It does NOT check
# for or quit After Effects: callers make sure it is closed first (the prefs
# step edits a file After Effects rewrites on quit).
#
# Progress protocol on stdout, one line each, in this order:
#   @@step <id> <state> <message>     ids: files node claude panel prefs connect
#                                     states: running | done | warn | fail
#   @@done <version>                  success (exit 0)
#   @@fail <id> <message>             first failure (exit 1)
# Human-readable detail goes to stderr.
#
# Test-only: APOSTLE_SKIP_NODE_DOWNLOAD=1 installs the runtime as a symlink to
# the node on PATH instead of downloading the pinned build.

set -uo pipefail
exec </dev/null

PAYLOAD=""
DEST="$HOME/Applications/Apostle AE Bridge"
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:?--dest needs a folder}"; shift 2 ;;
    *) PAYLOAD="$1"; shift ;;
  esac
done
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Private Node runtime, pinned (v22 LTS). Hashes from
# https://nodejs.org/dist/v22.23.4/SHASUMS256.txt
NODE_VERSION="v22.23.4"
NODE_SHA_ARM64="c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428"
NODE_SHA_X64="efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819"

step() { printf '@@step %s %s %s\n' "$1" "$2" "$3"; }
die()  { step "$1" fail "$2"; printf '@@fail %s %s\n' "$1" "$2"; exit 1; }
log()  { printf '%s\n' "$*" >&2; }

[ -n "$PAYLOAD" ] && [ -f "$PAYLOAD/release.json" ] || die files "not a release folder: ${PAYLOAD:-<none>}"
PAYLOAD="$(cd "$PAYLOAD" && pwd)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PAYLOAD/release.json")"

# ---------------------------------------------------------------- files
step files running "Copying Apostle AE Bridge $VERSION"
OLDV="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/release.json" 2>/dev/null)"
# app files replaced, the user's briefs, brand kits, runs and .env kept;
# also clears the download quarantine (AE won't load a quarantined panel)
/bin/bash "$PAYLOAD/scripts/apply-update.sh" "$PAYLOAD" "$DEST" >&2 || die files "could not copy files to $DEST"
if [ -n "$OLDV" ] && [ "$OLDV" != "$VERSION" ]; then
  step files done "Updated $OLDV to $VERSION"
else
  step files done "Installed version $VERSION"
fi

# ---------------------------------------------------------------- node
RT="$DEST/runtime/node"
NODE="$RT/bin/node"
step node running "Setting up the Node.js runtime"
if [ "${APOSTLE_SKIP_NODE_DOWNLOAD:-}" = "1" ]; then
  SYS_NODE="$(command -v node || true)"
  [ -n "$SYS_NODE" ] || die node "APOSTLE_SKIP_NODE_DOWNLOAD set but no node on PATH"
  mkdir -p "$RT/bin" && ln -sf "$SYS_NODE" "$NODE"
  step node done "Node.js $("$NODE" -v) (test runtime)"
elif [ -x "$NODE" ] && [ "$("$NODE" -v 2>/dev/null)" = "$NODE_VERSION" ]; then
  step node done "Node.js $NODE_VERSION (already installed)"
else
  case "$(uname -m)" in
    arm64) ARCH=arm64; SHA="$NODE_SHA_ARM64" ;;
    x86_64) ARCH=x64; SHA="$NODE_SHA_X64" ;;
    *) die node "unsupported Mac architecture: $(uname -m)" ;;
  esac
  NAME="node-$NODE_VERSION-darwin-$ARCH"
  WORK="$DEST/runtime/.download"
  rm -rf "$WORK" && mkdir -p "$WORK" || die node "could not create $WORK"
  step node running "Downloading Node.js $NODE_VERSION"
  curl -fsSL --retry 2 -o "$WORK/$NAME.tar.gz" "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" ||
    { rm -rf "$WORK"; die node "could not download Node.js (check the internet connection)"; }
  GOT="$(shasum -a 256 "$WORK/$NAME.tar.gz" | awk '{print $1}')"
  [ "$GOT" = "$SHA" ] || { rm -rf "$WORK"; die node "Node.js download failed its checksum"; }
  tar -xzf "$WORK/$NAME.tar.gz" -C "$WORK" || { rm -rf "$WORK"; die node "could not unpack Node.js"; }
  # keep the runtime lean: the bridge only needs bin/node
  rm -rf "$WORK/$NAME/include" "$WORK/$NAME/share" "$WORK/$NAME/lib" \
         "$WORK/$NAME/bin/npm" "$WORK/$NAME/bin/npx" "$WORK/$NAME/bin/corepack"
  "$WORK/$NAME/bin/node" -v >/dev/null 2>&1 || { rm -rf "$WORK"; die node "the downloaded Node.js does not run"; }
  rm -rf "$RT.new" && mv "$WORK/$NAME" "$RT.new" &&
    rm -rf "$RT.old" && { [ ! -e "$RT" ] || mv "$RT" "$RT.old"; } && mv "$RT.new" "$RT" ||
    { rm -rf "$WORK"; die node "could not put Node.js in place"; }
  rm -rf "$RT.old" "$WORK"
  step node done "Node.js $NODE_VERSION"
fi

# ---------------------------------------------------------------- claude
find_claude() {
  local c
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    [ -x "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  command -v claude 2>/dev/null
}
step claude running "Looking for Claude Code"
CLAUDE="$(find_claude || true)"
if [ -z "$CLAUDE" ]; then
  step claude running "Installing Claude Code (official installer from claude.ai)"
  curl -fsSL https://claude.ai/install.sh | bash >&2 || die claude "the Claude Code installer failed"
  CLAUDE="$(find_claude || true)"
  [ -n "$CLAUDE" ] || die claude "Claude Code installed but could not be found"
  step claude done "Installed Claude Code"
else
  step claude done "Claude Code found"
fi
log "claude: $CLAUDE"

# ---------------------------------------------------------------- panel
step panel running "Adding the Apostle panel to After Effects"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$CEP_DIR" && rm -rf "$CEP_DIR/apostle-panel" &&
  ln -s "$DEST/apostle-panel" "$CEP_DIR/apostle-panel" || die panel "could not install the Apostle panel"
# the Apostle panel is unsigned, so CEP's debug mode must allow it
for V in 11 12 13 14; do defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1 >&2 || true; done
mkdir -p "$HOME/Documents/ae-mcp-bridge" || die panel "could not create ~/Documents/ae-mcp-bridge"
step panel done "Apostle panel added (Window > Extensions > Apostle)"

# ---------------------------------------------------------------- prefs
# "Allow Scripts to Write Files and Access Network": scripts may not change it,
# but its prefs file can be edited while After Effects is closed.
step prefs running "Letting After Effects scripts save previews"
PREFS_DONE=0
for f in "$HOME/Library/Preferences/Adobe/After Effects/"*/"Adobe After Effects "*" Prefs.txt"; do
  [ -f "$f" ] || continue
  v="$(basename "$(dirname "$f")")"; major="${v%%.*}"
  [ "$major" -ge 24 ] 2>/dev/null || continue
  if LC_ALL=C grep -q '"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "0"' "$f"; then
    cp "$f" "$f.before-apostle" &&
    LC_ALL=C sed -i '' 's/"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "0"/"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "1"/' "$f" &&
    PREFS_DONE=1
  elif LC_ALL=C grep -q '"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "1"' "$f"; then
    PREFS_DONE=1
  fi
done
if [ $PREFS_DONE = 1 ]; then
  step prefs done "After Effects scripts may save previews"
else
  step prefs warn "Couldn't switch on 'Allow Scripts to Write Files' (open After Effects once, then install again, or tick it in Settings > Scripting & Expressions)"
fi

# ---------------------------------------------------------------- connect
step connect running "Connecting Claude Code to After Effects"
"$CLAUDE" mcp remove -s user AfterEffectsMCP >&2 2>&1 || true
"$CLAUDE" mcp add -s user AfterEffectsMCP -- "$NODE" "$DEST/build/index.js" >&2 ||
  die connect "could not register the bridge with Claude Code"
SMOKE="$("$NODE" -e '
const { spawn } = require("child_process");
const p = spawn(process.argv[1], [process.argv[2]], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
p.stderr.on("data", d => out += d); p.stdout.on("data", d => out += d);
const t = setInterval(() => { if (/running/.test(out)) { clearInterval(t); p.kill(); console.log("ok"); } }, 100);
setTimeout(() => { clearInterval(t); p.kill(); if (!/running/.test(out)) console.log((out || "no output").slice(0, 300).replace(/\s+/g, " ")); }, 3000);
' "$NODE" "$DEST/build/index.js" 2>&1)"
[ "$SMOKE" = "ok" ] || die connect "the bridge server did not start: $SMOKE"
step connect done "Claude Code can now use After Effects"

printf '@@done %s\n' "$VERSION"
