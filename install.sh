#!/bin/sh
# Install Intelliprompter and start it: curl -fsSL https://raw.githubusercontent.com/thesnarkitecht/intelliprompter/main/install.sh | sh
set -e
DIR="${INTELLIPROMPTER_DIR:-$HOME/intelliprompter}"
BIN="$HOME/.local/bin"

command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is needed: https://nodejs.org" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node.js 22 or newer is needed (you have $(node -v)): https://nodejs.org" >&2; exit 1; }

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
