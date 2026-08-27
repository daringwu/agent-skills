#!/usr/bin/env bash
# Install skills into a tool's skills directory.
#
#   ./install.sh                        # 软链所有 skill 到已存在的 ~/.codex/skills 和 ~/.claude/skills
#   ./install.sh --scope personal       # 只装通用 skill（个人机器用这个）
#   ./install.sh --scope gaotu          # 只装依赖公司内部系统的 skill
#   ./install.sh --codex                # 只装到 Codex
#   ./install.sh --claude               # 只装到 Claude Code
#   ./install.sh --dir <path>           # 其他工具的 skills 目录
#   ./install.sh --copy                 # 拷贝而非软链
#   ./install.sh --only <skill-name>    # 只装某一个 skill（按 skill 名，不带 scope）
#
# 仓库里按 scope 分目录（skills/<scope>/<name>），但**安装后是平铺的**
# （<target>/<name>）—— 各工具直接读 skills 目录下一层，不认嵌套。
#
# 凭据不随安装走：留在 ~/.config/agent-skills/<skill>/env，每台机器一份。
# 装完对每个 skill 跑一次 scripts/preflight.mjs。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE=symlink
ONLY=""
SCOPE=""
TARGETS=()
EXPLICIT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --codex)  TARGETS+=("$HOME/.codex/skills"); EXPLICIT=1 ;;
    --claude) TARGETS+=("$HOME/.claude/skills"); EXPLICIT=1 ;;
    --dir)    shift; TARGETS+=("$1"); EXPLICIT=1 ;;
    --copy)   MODE=copy ;;
    --only)   shift; ONLY="$1" ;;
    --scope)  shift; SCOPE="$1" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -n "$SCOPE" ] && [ ! -d "$ROOT/skills/$SCOPE" ]; then
  echo "没有这个 scope：$SCOPE（可选：$(cd "$ROOT/skills" && ls -d */ | tr -d '/' | tr '\n' ' '))" >&2
  exit 2
fi

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

# 收集待安装的 skill，并检查跨 scope 同名冲突（安装后是平铺的，同名会互相覆盖）
SELECTED=()
declare -a SEEN_NAMES=()
for src in "$ROOT"/skills/${SCOPE:-*}/*/; do
  [ -f "$src/requirements.json" ] || continue
  name="$(basename "$src")"
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && continue
  for prev in ${SEEN_NAMES+"${SEEN_NAMES[@]}"}; do
    if [ "$prev" = "$name" ]; then
      echo "冲突：多个 scope 下都有 skill \"$name\"，平铺安装会互相覆盖。请先改名。" >&2
      exit 1
    fi
  done
  SEEN_NAMES+=("$name")
  SELECTED+=("${src%/}")
done

if [ "${#SELECTED[@]}" -eq 0 ]; then
  echo "没有匹配的 skill。" >&2
  exit 1
fi

for target in "${TARGETS[@]}"; do
  mkdir -p "$target"
  echo "→ $target"
  for src in "${SELECTED[@]}"; do
    name="$(basename "$src")"
    scope="$(basename "$(dirname "$src")")"
    dest="$target/$name"

    if [ -e "$dest" ] || [ -L "$dest" ]; then
      if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
        echo "   = $scope/$name (已是指向本仓库的软链)"
        continue
      fi
      backup="$dest.bak.$$"
      mv "$dest" "$backup"
      echo "   ! $name 已存在，原目录备份到 $(basename "$backup")"
    fi

    if [ "$MODE" = symlink ]; then
      ln -s "$src" "$dest"
      echo "   + $scope/$name (symlink)"
    else
      cp -R "$src" "$dest"
      echo "   + $scope/$name (copy)"
    fi
  done
done

echo
echo "下一步：对每个 skill 跑一次 preflight，看还缺什么"
for src in "${SELECTED[@]}"; do
  echo "  node ${TARGETS[0]}/$(basename "$src")/scripts/preflight.mjs"
done
