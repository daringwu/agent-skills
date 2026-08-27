#!/usr/bin/env node
// Generic skill setup. Do not edit inside a skill directory:
// this file is a synced copy of tools/templates/setup.mjs.
//
// Contract:
//   - Installs ONLY requirements with tier "auto", using the exact command pinned
//     in requirements.json. It never invents an install command.
//   - tier "assisted" is printed for confirmation and runs only with --yes-assisted.
//   - tier "manual" is never attempted; it is reported as your work.
//   - Exits with the final preflight status code (0 ready / 10 degraded / 20 blocked).
//
// Flags: --yes-assisted  --dry-run  --only <id>

import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = path.join(SCRIPT_DIR, "preflight.mjs");

function parseArgs(argv) {
  const out = { yesAssisted: false, dryRun: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--yes-assisted") out.yesAssisted = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--only") { out.only = argv[i + 1]; i += 1; }
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  return out;
}

function preflightJson(extra = []) {
  try {
    const out = execFileSync("node", [PREFLIGHT, "--json", ...extra], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    // preflight exits 10/20 on degraded/blocked; stdout still holds valid JSON.
    const stdout = e.stdout ?? "";
    if (stdout.trim().startsWith("{")) return JSON.parse(stdout);
    console.error(`setup: preflight failed\n${e.stderr ?? e.message}`);
    process.exit(2);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const before = preflightJson(["--no-cache"]);

  if (before.status === "READY") {
    console.log(`✅ ${before.skill} 已就绪，无需安装。`);
    process.exit(0);
  }

  const reqs = before.requirements;
  let blockers = before.blockers.filter((b) => !reqs[b.id]?.skipped);
  if (opts.only) blockers = blockers.filter((b) => b.id === opts.only);

  const auto = blockers.filter((b) => b.tier === "auto");
  const assisted = blockers.filter((b) => b.tier === "assisted");
  const manual = blockers.filter((b) => b.tier === "manual");

  console.log(`${before.skill} — setup`);
  console.log("");

  if (!auto.length && !(opts.yesAssisted && assisted.length)) {
    console.log("没有可自动安装的项。");
  }

  for (const b of auto) {
    const cmd = reqs[b.id].install;
    if (!cmd) {
      console.log(`⚠️  ${b.id}：tier=auto 但清单里没有 install 命令，跳过（不会自行编造命令）。`);
      continue;
    }
    console.log(`▶ [auto] ${b.id}`);
    console.log(`  $ ${cmd}`);
    if (opts.dryRun) { console.log("  (dry-run，未执行)"); continue; }
    try {
      execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 300000 });
      console.log("  ✅ 完成");
    } catch (e) {
      const tail = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-4).join("\n      ");
      console.log(`  ❌ 失败：\n      ${tail}`);
    }
    console.log("");
  }

  if (assisted.length) {
    if (opts.yesAssisted) {
      for (const b of assisted) {
        const cmd = reqs[b.id].install;
        if (!cmd) { console.log(`⚠️  ${b.id}：无 install 命令，跳过。`); continue; }
        console.log(`▶ [assisted, 已获确认] ${b.id}`);
        console.log(`  $ ${cmd}`);
        if (opts.dryRun) { console.log("  (dry-run，未执行)"); continue; }
        try {
          execSync(cmd, { stdio: "inherit", timeout: 600000 });
          console.log("  ✅ 完成");
        } catch (e) {
          console.log(`  ❌ 失败：${e.message}`);
        }
        console.log("");
      }
    } else {
      console.log("需要你确认后才会执行（有全局副作用，未执行）：");
      for (const b of assisted) {
        const r = reqs[b.id];
        console.log(`  - ${b.id}：$ ${r.install ?? "(无命令)"}`);
        if (r.sideEffect) console.log(`    副作用：${r.sideEffect}`);
      }
      console.log("  同意后重跑：node scripts/setup.mjs --yes-assisted");
      console.log("");
    }
  }

  if (manual.length) {
    console.log("只能你自己做（setup 不会尝试）：");
    for (const b of manual) {
      console.log(`  - ${b.id}：${reqs[b.id].note}`);
      if (reqs[b.id].approval) console.log(`    ⏳ ${reqs[b.id].approval}`);
    }
    console.log("  详细步骤：node scripts/preflight.mjs（或 --explain）");
    console.log("");
  }

  console.log("─".repeat(60));
  const after = preflightJson(["--no-cache"]);
  try {
    execFileSync("node", [PREFLIGHT], { stdio: "inherit" });
  } catch {
    /* preflight's own exit code is handled below */
  }
  process.exit(after.exitCode);
}

main();
