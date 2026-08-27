#!/usr/bin/env bash
# Sync shared files into every skill:
#   - tools/templates/{preflight,setup}.mjs  -> skills/<name>/scripts/
#   - policies/shared/<id>.md               -> skills/<name>/policies/shared/
#     (only the ids listed in that skill's policies/policy.json "shared" array)
#
# Why copies instead of a shared lib/: each skill must stay independently
# installable. Codex's skill-installer fetches skills/<name> only, so a skill
# that reached outside its own directory would break when installed alone.
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
  synced="scripts"

  policy="$skill/policies/policy.json"
  if [ -f "$policy" ]; then
    ids="$(node -e '
      const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write((p.shared ?? []).join("\n"));
    ' "$policy")"
    if [ -n "$ids" ]; then
      mkdir -p "$skill/policies/shared"
      while IFS= read -r id; do
        [ -n "$id" ] || continue
        src="$ROOT/policies/shared/$id.md"
        if [ ! -f "$src" ]; then
          echo "  !! $name 声明了 shared policy \"$id\"，但 $src 不存在" >&2
          exit 1
        fi
        cp "$src" "$skill/policies/shared/$id.md"
        synced="$synced, shared:$id"
      done <<< "$ids"
    fi
  fi

  echo "synced $name ($synced)"
done
