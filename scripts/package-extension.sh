#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/manifest.json').version")"
ARCHIVE="$ROOT/dist/codex-usage-pacer-v$VERSION.zip"

mkdir -p "$ROOT/dist"
rm -f "$ARCHIVE"

cd "$ROOT"
# Everything the manifest loads (service worker, content scripts, icons), read
# from manifest.json itself so a new runtime file cannot be left out of the ZIP,
# plus the license for the Lucide icons embedded in credit-expiry-ui.js.
FILES=()
while IFS= read -r file; do FILES+=("$file"); done < <(node -e '
  const m = require("./manifest.json");
  const files = new Set(["manifest.json"]);
  if (m.background?.service_worker) files.add(m.background.service_worker);
  for (const s of m.content_scripts ?? []) {
    for (const f of [...(s.js ?? []), ...(s.css ?? [])]) files.add(f);
  }
  for (const f of Object.values(m.icons ?? {})) files.add(f);
  console.log([...files].join("\n"));
')
zip -X -q "$ARCHIVE" "${FILES[@]}" LUCIDE-LICENSE.txt

echo "Created $ARCHIVE (${#FILES[@]} runtime files + LUCIDE-LICENSE.txt)"
