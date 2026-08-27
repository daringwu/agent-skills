#!/usr/bin/env bash
# Copy the generic preflight/setup templates into every skill.
#
# Why copies instead of a shared lib/: each skill must stay independently
# installable. Codex's skill-installer fetches skills/<name> only, so a skill
# that imported ../../lib/ would break the moment it is installed alone.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for skill in "$ROOT"/skills/*/; do
  name="$(basename "$skill")"
  [ -f "$skill/requirements.json" ] || { echo "skip $name (no requirements.json)"; continue; }
  mkdir -p "$skill/scripts"
  for f in preflight.mjs setup.mjs; do
    cp "$ROOT/tools/templates/$f" "$skill/scripts/$f"
    chmod +x "$skill/scripts/$f"
  done
  echo "synced $name"
done
