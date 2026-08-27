#!/usr/bin/env bash
# Install these skills into a tool's skills directory.
#
#   ./install.sh                      # symlink all skills into ~/.codex/skills and ~/.claude/skills (whichever exist)
#   ./install.sh --codex              # only Codex
#   ./install.sh --claude             # only Claude Code
#   ./install.sh --dir <path>         # any other tool's skills directory
#   ./install.sh --copy               # copy instead of symlink
#   ./install.sh --only <skill-name>  # one skill only
#
# Symlink is the default so `git pull` updates every tool at once.
# Credentials are NOT installed: they live in ~/.config/agent-skills/<skill>/env
# on each machine. Run each skill's scripts/preflight.mjs afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE=symlink
ONLY=""
TARGETS=()
EXPLICIT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --codex)  TARGETS+=("$HOME/.codex/skills"); EXPLICIT=1 ;;
    --claude) TARGETS+=("$HOME/.claude/skills"); EXPLICIT=1 ;;
    --dir)    shift; TARGETS+=("$1"); EXPLICIT=1 ;;
    --copy)   MODE=copy ;;
    --only)   shift; ONLY="$1" ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$EXPLICIT" -eq 0 ]; then
  for d in "$HOME/.codex/skills" "$HOME/.claude/skills"; do
    [ -d "$d" ] && TARGETS+=("$d")
  done
  if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "找不到任何已知的 skills 目录，请用 --dir <path> 指定。" >&2
    exit 1
  fi
fi

"$ROOT/tools/sync-core.sh" >/dev/null

for target in "${TARGETS[@]}"; do
  mkdir -p "$target"
  echo "→ $target"
  for src in "$ROOT"/skills/*/; do
    name="$(basename "$src")"
    [ -f "$src/requirements.json" ] || continue
    [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
    dest="$target/$name"

    if [ -e "$dest" ] || [ -L "$dest" ]; then
      if [ -L "$dest" ] && [ "$(readlink "$dest")" = "${src%/}" ]; then
        echo "   = $name (已是指向本仓库的软链)"
        continue
      fi
      backup="$dest.bak.$$"
      mv "$dest" "$backup"
      echo "   ! $name 已存在，原目录备份到 $(basename "$backup")"
    fi

    if [ "$MODE" = symlink ]; then
      ln -s "${src%/}" "$dest"
      echo "   + $name (symlink)"
    else
      cp -R "${src%/}" "$dest"
      echo "   + $name (copy)"
    fi
  done
done

echo
echo "下一步：对每个 skill 跑一次 preflight，看还缺什么"
for src in "$ROOT"/skills/*/; do
  name="$(basename "$src")"
  [ -f "$src/requirements.json" ] || continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  echo "  node ${TARGETS[0]}/$name/scripts/preflight.mjs"
done
