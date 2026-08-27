#!/usr/bin/env bash
# List every quantified policy still undefined (value === null), plus TODO
# markers in the judgment-based policy docs.
# Undefined policy means: ask the user, never assume.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const skillsDir = path.join(root, "skills");
let total = 0, seen = 0;
for (const scope of fs.readdirSync(skillsDir)) {
  const scopeDir = path.join(skillsDir, scope);
  if (!fs.statSync(scopeDir).isDirectory()) continue;
  for (const skill of fs.readdirSync(scopeDir)) {
    const p = path.join(scopeDir, skill, "policies", "policy.json");
    if (!fs.existsSync(p)) continue;
    seen += 1;
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const rules = doc.rules ?? {};
    const open = Object.entries(rules).filter(([, r]) => r.value === null);
    console.log(`\n${scope}/${skill}  (${open.length} 项待定义 / 共 ${Object.keys(rules).length} 项)`);
    for (const [k, r] of open) {
      total += 1;
      console.log(`  · ${k}`);
      if (r.note) console.log(`      用途：${r.note}`);
      if (r.todo) console.log(`      要问：${r.todo}`);
    }
    if (!open.length) console.log("  ✅ 量化口径已全部定义");
  }
}
console.log(`\n${seen} 个 skill，合计 ${total} 项量化口径待定义。`);
' "$ROOT"

echo
echo "判断类口径文档里的 TODO 段落："
grep -rn "TODO\|待定义\|骨架" "$ROOT/policies" "$ROOT"/skills/*/*/policies/*.md 2>/dev/null \
  | grep -v "policy.json" | sed "s|$ROOT/|  |" || echo "  （无）"
