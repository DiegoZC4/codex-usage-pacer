#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
ARCHIVE="$ROOT/dist/codex-usage-pacer-v$VERSION.zip"

mkdir -p "$ROOT/dist"
rm -f "$ARCHIVE"

cd "$ROOT"
zip -X -q "$ARCHIVE" \
  manifest.json \
  content.js \
  reset-log-core.js \
  icons/icon-16.png \
  icons/icon-32.png \
  icons/icon-48.png \
  icons/icon-128.png

echo "Created $ARCHIVE"
