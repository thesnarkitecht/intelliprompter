#!/bin/sh
# Install Intelliprompter and start it: curl -fsSL https://raw.githubusercontent.com/thesnarkitecht/intelliprompter/main/install.sh | sh
set -e
DIR="${INTELLIPROMPTER_DIR:-$HOME/intelliprompter}"

command -v node >/dev/null 2>&1 || { echo "Node.js 22 or newer is needed: https://nodejs.org" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node.js 22 or newer is needed (you have $(node -v)): https://nodejs.org" >&2; exit 1; }

mkdir -p "$DIR"
# Overwrites the app files but leaves your .env alone.
curl -fsSL https://github.com/thesnarkitecht/intelliprompter/archive/refs/heads/main.tar.gz | tar -xz -C "$DIR" --strip-components=1
echo "Installed to $DIR"
npm --prefix "$DIR" run --silent serve
