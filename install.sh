#!/bin/sh
# Install Intelliprompter and start it: curl -fsSL https://raw.githubusercontent.com/thesnarkitecht/intelliprompter/main/install.sh | sh
set -e
DIR="${INTELLIPROMPTER_DIR:-$HOME/intelliprompter}"
BIN="$HOME/.local/bin"

# Needs Node 22.9+ (for --env-file-if-exists).
command -v node >/dev/null 2>&1 || { echo "Node.js 22.9 or newer is needed: https://nodejs.org" >&2; exit 1; }
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 9) ? 0 : 1)' || {
  echo "Node.js 22.9 or newer is needed (you have $(node -v)). Update it, then run this again:" >&2
  echo "  Homebrew:  brew install node@22 && brew link --overwrite --force node@22" >&2
  echo "  nvm:       nvm install 22 && nvm alias default 22" >&2
  echo "  Or download the LTS installer from https://nodejs.org" >&2
  exit 1
}

mkdir -p "$DIR" "$BIN"
# Updating: stop a running copy so the new code is what starts.
[ -x "$DIR/bin/intelliprompter" ] && "$DIR/bin/intelliprompter" stop >/dev/null 2>&1 || true
# Overwrites the app files but leaves your .env alone.
curl -fsSL https://github.com/thesnarkitecht/intelliprompter/archive/refs/heads/main.tar.gz | tar -xz -C "$DIR" --strip-components=1
chmod +x "$DIR/bin/intelliprompter"
printf '#!/bin/sh\nexec "%s/bin/intelliprompter" "$@"\n' "$DIR" > "$BIN/intelliprompter"
chmod +x "$BIN/intelliprompter"
echo "Installed to $DIR"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add this line to your shell profile (~/.zshrc or ~/.bashrc) so 'intelliprompter' works everywhere:"
     echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

"$DIR/bin/intelliprompter" serve
