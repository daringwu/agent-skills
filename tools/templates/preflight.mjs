#!/usr/bin/env node
// Generic skill preflight. Do not edit inside a skill directory:
// this file is a synced copy of tools/templates/preflight.mjs.
//
// Contract:
//   - CHECKS ONLY. Never installs, never mutates the system, never prints secret values.
//   - exit 0  = every capability READY
//   - exit 10 = some capabilities READY (degraded)
//   - exit 20 = no capability READY (blocked)
//   - exit 2  = manifest/usage error
//
// Flags: --json  --explain  --capability <id>  --no-cache  --quiet

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = path.join(SKILL_DIR, "requirements.json");
const STATE_VERSION = 1;

const TIERS = {
  auto: { rank: 0, label: "AI 可以直接做" },
  assisted: { rank: 1, label: "需要你确认后 AI 再做" },
  manual: { rank: 2, label: "只能你自己做" },
};

function parseArgs(argv) {
  const out = { json: false, explain: false, capability: null, cache: true, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--explain") out.explain = true;
    else if (a === "--no-cache") out.cache = false;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--capability") { out.capability = argv[i + 1]; i += 1; }
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  return out;
}

function die(msg) {
  console.error(`preflight: ${msg}`);
  process.exit(2);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) die(`missing ${MANIFEST_PATH}`);
  let m;
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (e) {
    die(`requirements.json is not valid JSON: ${e.message}`);
  }
  if (!m.name) die("requirements.json needs a top-level \"name\"");
  if (!m.capabilities || !m.requirements) die("requirements.json needs \"capabilities\" and \"requirements\"");
  for (const [capId, cap] of Object.entries(m.capabilities)) {
    for (const reqId of cap.requires ?? []) {
      if (!m.requirements[reqId]) die(`capability "${capId}" references unknown requirement "${reqId}"`);
    }
  }
  for (const [reqId, req] of Object.entries(m.requirements)) {
    if (!TIERS[req.tier]) die(`requirement "${reqId}" has invalid tier "${req.tier}"`);
    for (const dep of req.dependsOn ?? []) {
      if (!m.requirements[dep]) die(`requirement "${reqId}" dependsOn unknown "${dep}"`);
    }
  }
  return m;
}

// Stable hash so the cache invalidates whenever the manifest changes.
function hashManifest(manifest) {
  const text = JSON.stringify(manifest.requirements) + JSON.stringify(manifest.capabilities);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 + c) * 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

function configHome() {
  return process.env.AGENT_SKILLS_HOME || path.join(os.homedir(), ".config", "agent-skills");
}

function paths(manifest) {
  const dir = path.join(configHome(), manifest.name);
  return { dir, envFile: path.join(dir, "env"), stateFile: path.join(dir, "state.json") };
}

// Loads the per-machine env file. Values are used for checks but NEVER printed.
function loadEnv(envFile) {
  const merged = { ...process.env };
  const fromFile = [];
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      merged[k] = v;
      fromFile.push(k);
    }
  }
  return { merged, fromFile };
}

function envFilePerms(envFile) {
  if (!fs.existsSync(envFile)) return null;
  return (fs.statSync(envFile).mode & 0o777).toString(8).padStart(3, "0");
}

function readState(stateFile) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (s.stateVersion !== STATE_VERSION) return null;
    return s;
  } catch {
    return null;
  }
}

function writeState(stateFile, state) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* cache is best-effort; never fail preflight over it */
  }
}

function expandPath(p, ctx) {
  return p
    .replace(/^~(?=\/|$)/, os.homedir())
    .replace(/\$SKILL_DIR/g, ctx.skillDir)
    .replace(/\$CONFIG_DIR/g, ctx.configDir);
}

function run(cmd, env, timeoutMs) {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf8",
      timeout: timeoutMs ?? 30000,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    return { code: 0, out: stdout ?? "" };
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const code = typeof e.status === "number" ? e.status : 1;
    return { code, out, killed: e.killed === true || e.signal != null };
  }
}

function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function versionAtLeast(found, min) {
  const a = parseVersion(found);
  const b = parseVersion(/^\d+$/.test(min) ? `${min}.0.0` : min);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return true;
}

function checkRequirement(id, req, ctx) {
  const kind = req.kind ?? "command";

  if (kind === "env") {
    const names = Array.isArray(req.check) ? req.check : [req.check];
    const missing = names.filter((n) => !ctx.env.merged[n] || String(ctx.env.merged[n]).trim() === "");
    if (missing.length) {
      return { ok: false, note: `缺少变量：${missing.join(", ")}`, missingKeys: missing };
    }
    // Presence only. Values are never surfaced.
    return { ok: true, note: `已配置 ${names.length} 个变量（值不显示）` };
  }

  if (kind === "file") {
    const target = expandPath(String(req.check), ctx);
    return fs.existsSync(target)
      ? { ok: true, note: `存在：${target}` }
      : { ok: false, note: `不存在：${target}` };
  }

  if (kind === "binary" || kind === "command" || kind === "npx") {
    const cmd = String(req.check);
    const r = run(cmd, ctx.env.merged, req.timeoutMs);
    const text = r.out.trim();
    if (r.killed) return { ok: false, note: `检查超时（${req.timeoutMs ?? 30000}ms）：${cmd}` };
    if (r.code !== 0) {
      const first = text.split("\n").filter(Boolean)[0] ?? `exit ${r.code}`;
      return { ok: false, note: `命令失败：${first.slice(0, 200)}` };
    }
    if (req.expect) {
      const re = new RegExp(req.expect);
      if (!re.test(text)) {
        return { ok: false, note: `输出不符合预期（期望匹配 /${req.expect}/）` };
      }
    }
    if (req.minVersion) {
      const found = parseVersion(text);
      const okv = versionAtLeast(text, req.minVersion);
      if (okv === false) {
        return { ok: false, note: `版本过低：当前 ${found ? found.join(".") : "未知"}，需要 >= ${req.minVersion}` };
      }
      if (okv === null) {
        return { ok: true, note: `无法解析版本号，视为通过（要求 >= ${req.minVersion}）` };
      }
      return { ok: true, note: `版本 ${found.join(".")} >= ${req.minVersion}` };
    }
    const summary = text.split("\n").filter(Boolean)[0];
    return { ok: true, note: summary ? summary.slice(0, 120) : "通过" };
  }

  return { ok: false, note: `未知的 kind："${kind}"` };
}

function evaluate(manifest, opts) {
  const p = paths(manifest);
  const ctx = {
    env: loadEnv(p.envFile),
    skillDir: SKILL_DIR,
    configDir: p.dir,
  };
  // Exposed to check/install commands so complex checks can live in scripts/checks/*.mjs
  // instead of being crammed into a JSON string.
  ctx.env.merged.SKILL_DIR = SKILL_DIR;
  ctx.env.merged.CONFIG_DIR = p.dir;
  ctx.env.merged.ENV_FILE = p.envFile;

  const hash = hashManifest(manifest);
  const prev = opts.cache ? readState(p.stateFile) : null;
  const cacheValid = prev && prev.requirementsHash === hash;
  const now = Date.now();

  let capIds = Object.keys(manifest.capabilities);
  if (opts.capability) {
    if (!manifest.capabilities[opts.capability]) die(`unknown capability "${opts.capability}"`);
    capIds = [opts.capability];
  }

  const needed = new Set();
  for (const c of capIds) for (const r of manifest.capabilities[c].requires ?? []) needed.add(r);

  // Dependency-ordered so a failing prerequisite short-circuits its dependents
  // instead of producing a cascade of misleading errors.
  const order = [];
  const visited = new Set();
  const visit = (id, stack) => {
    if (visited.has(id)) return;
    if (stack.includes(id)) die(`dependsOn cycle: ${[...stack, id].join(" -> ")}`);
    for (const dep of manifest.requirements[id].dependsOn ?? []) {
      if (needed.has(dep)) visit(dep, [...stack, id]);
    }
    visited.add(id);
    order.push(id);
  };
  for (const id of needed) visit(id, []);

  const results = {};
  for (const id of order) {
    const req = manifest.requirements[id];
    const failedDeps = (req.dependsOn ?? []).filter((d) => results[d] && !results[d].ok);
    if (failedDeps.length) {
      results[id] = {
        ok: false,
        skipped: true,
        note: `未检查，等前置项完成：${failedDeps.join(", ")}`,
        at: now,
        cached: false,
      };
      continue;
    }
    const cached = cacheValid ? prev.results?.[id] : null;
    const ttlDays = req.cacheDays ?? manifest.defaultCacheDays ?? 7;
    const fresh = cached && cached.ok && now - cached.at < ttlDays * 86400000;
    // Volatile requirements (tokens, logins) are always re-checked; durable ones use the cache.
    if (!req.volatile && fresh) {
      results[id] = { ...cached, cached: true };
      continue;
    }
    const r = checkRequirement(id, req, ctx);
    results[id] = { ...r, at: now, cached: false };
  }

  const capabilities = capIds.map((id) => {
    const cap = manifest.capabilities[id];
    const reqs = cap.requires ?? [];
    const missing = reqs.filter((r) => !results[r]?.ok);
    return {
      id,
      label: cap.label ?? id,
      description: cap.description ?? "",
      ready: missing.length === 0,
      missing,
    };
  });

  const readyCount = capabilities.filter((c) => c.ready).length;
  const status = readyCount === capabilities.length ? "READY" : readyCount > 0 ? "DEGRADED" : "BLOCKED";
  const exitCode = status === "READY" ? 0 : status === "DEGRADED" ? 10 : 20;

  // Persist only durable passes; failures are never cached so they get re-checked.
  const toCache = { ...(cacheValid ? prev.results : {}) };
  for (const [id, r] of Object.entries(results)) {
    const req = manifest.requirements[id];
    if (r.ok && !req.volatile) toCache[id] = { ok: true, note: r.note, at: r.at };
    else delete toCache[id];
  }
  writeState(p.stateFile, {
    stateVersion: STATE_VERSION,
    skill: manifest.name,
    requirementsHash: hash,
    updatedAt: new Date(now).toISOString(),
    lastStatus: status,
    results: toCache,
  });

  const blockers = [...needed]
    .filter((id) => !results[id].ok)
    .sort((a, b) => {
      const sa = results[a].skipped ? 1 : 0;
      const sb = results[b].skipped ? 1 : 0;
      if (sa !== sb) return sa - sb;
      const ta = TIERS[manifest.requirements[a].tier].rank;
      const tb = TIERS[manifest.requirements[b].tier].rank;
      if (ta !== tb) return ta - tb;
      return (manifest.requirements[a].order ?? 99) - (manifest.requirements[b].order ?? 99);
    });

  return { manifest, paths: p, results, capabilities, status, exitCode, blockers, ctx };
}

function renderHuman(ev, opts) {
  const { manifest, paths: p, results, capabilities, status, blockers } = ev;
  const L = [];
  const icon = { READY: "✅", DEGRADED: "⚠️ ", BLOCKED: "⛔" }[status];
  L.push(`${icon} ${manifest.name} — ${status}`);
  if (manifest.summary) L.push(`   ${manifest.summary}`);
  L.push("");

  if (!blockers.length) {
    L.push("所有前提条件已满足，可以直接开始。");
    const perms = envFilePerms(p.envFile);
    if (perms && perms !== "600") {
      L.push("");
      L.push(`⚠️  凭据文件权限是 ${perms}，建议改为 600：chmod 600 ${p.envFile}`);
    }
    return L.join("\n");
  }

  const actionable = blockers.filter((id) => !results[id].skipped);
  const pending = blockers.filter((id) => results[id].skipped);

  const groups = { auto: [], assisted: [], manual: [] };
  for (const id of actionable) groups[manifest.requirements[id].tier].push(id);

  const blockedCapabilities = capabilities.filter((c) => !c.ready).map((c) => c.id);
  if (blockedCapabilities.length) {
    L.push(`暂不可用：${blockedCapabilities.join(", ")}`);
    L.push("");
  }

  const missingEnv = actionable.some((id) => manifest.requirements[id].kind === "env");
  if (missingEnv) {
    L.push("先准备配置文件：");
    L.push(`  mkdir -p "${p.dir}" && touch "${p.envFile}" && chmod 600 "${p.envFile}" && \${EDITOR:-vi} "${p.envFile}"`);
    L.push("");
  }

  for (const tier of ["auto", "assisted", "manual"]) {
    const ids = groups[tier];
    if (!ids.length) continue;
    L.push(`${TIERS[tier].label}（${ids.length} 项）`);
    ids.forEach((id, i) => {
      const req = manifest.requirements[id];
      const r = results[id];
      L.push(`  ${i + 1}. ${req.label ?? id}`);
      L.push(`     缺少：${r.note}`);
      if (tier === "auto" && req.install) L.push(`     AI 执行：${req.install}`);
      if (tier === "assisted" && req.install) {
        L.push(`     待确认命令：${req.install}`);
        if (req.sideEffect) L.push(`     副作用：${req.sideEffect}`);
      }
      const quickGuide = String(req.quickGuide ?? req.guide ?? "")
        .replace(/\$SKILL_DIR/g, SKILL_DIR)
        .replace(/\$ENV_FILE/g, p.envFile)
        .replace(/\$CONFIG_DIR/g, p.dir);
      if (quickGuide) for (const line of String(quickGuide).split("\n")) L.push(`     ${line}`);
      L.push("");
    });
  }

  if (pending.length) {
    L.push(`配置完成后会自动检查其余 ${pending.length} 项，无需现在处理。`);
    L.push("");
  }

  L.push("完成任一步后重跑：");
  L.push(`  node ${path.relative(process.cwd(), path.join(SKILL_DIR, "scripts", "preflight.mjs")) || "scripts/preflight.mjs"}`);
  if (groups.auto.length) {
    L.push("AI 安装 auto 项：");
    L.push(`  node ${path.relative(process.cwd(), path.join(SKILL_DIR, "scripts", "setup.mjs")) || "scripts/setup.mjs"}`);
  }
  L.push("详细说明：node scripts/preflight.mjs --explain");
  return L.join("\n");
}

function renderExplain(manifest) {
  const p = paths(manifest);
  const L = [];
  L.push(`# ${manifest.name} — 前提条件说明`);
  if (manifest.summary) L.push(`\n${manifest.summary}`);
  L.push(`\n凭据与状态目录：\`${p.dir}\``);
  L.push(`凭据文件：\`${p.envFile}\`（chmod 600，不进仓库）`);
  L.push("\n## 能力与依赖\n");
  for (const [id, cap] of Object.entries(manifest.capabilities)) {
    L.push(`- **${id}** — ${cap.label ?? ""}${cap.description ? `：${cap.description}` : ""}`);
    L.push(`  - 依赖：${(cap.requires ?? []).join(", ") || "无"}`);
  }
  L.push("\n## 依赖清单\n");
  L.push("| id | 级别 | 类型 | 说明 | 谁来做 |");
  L.push("|---|---|---|---|---|");
  for (const [id, req] of Object.entries(manifest.requirements)) {
    const who = req.tier === "auto" ? "AI 直接装" : req.tier === "assisted" ? "AI 装，需你确认" : "只能你做";
    L.push(`| \`${id}\` | ${req.tier} | ${req.kind ?? "command"} | ${(req.label ?? "").replace(/\|/g, "\\|")} | ${who} |`);
  }
  L.push("\n## 人工步骤\n");
  const manual = Object.entries(manifest.requirements)
    .filter(([, r]) => r.tier !== "auto")
    .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99));
  for (const [id, req] of manual) {
    L.push(`### ${id}${req.label ? ` — ${req.label}` : ""}`);
    if (req.guide) L.push(req.guide);
    if (req.approval) L.push(`\n⏳ 审批：${req.approval}`);
    if (req.docs) L.push(`\n文档：${req.docs}`);
    L.push("");
  }
  return L.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = readManifest();

  if (opts.explain) {
    console.log(renderExplain(manifest));
    process.exit(0);
  }

  const ev = evaluate(manifest, opts);

  if (opts.json) {
    console.log(JSON.stringify({
      skill: manifest.name,
      status: ev.status,
      exitCode: ev.exitCode,
      configDir: ev.paths.dir,
      envFile: ev.paths.envFile,
      capabilities: ev.capabilities,
      requirements: Object.fromEntries(Object.entries(ev.results).map(([id, r]) => [id, {
        ok: r.ok,
        tier: manifest.requirements[id].tier,
        kind: manifest.requirements[id].kind ?? "command",
        volatile: !!manifest.requirements[id].volatile,
        cached: !!r.cached,
        skipped: !!r.skipped,
        dependsOn: manifest.requirements[id].dependsOn ?? undefined,
        note: r.note,
        missingKeys: r.missingKeys ?? undefined,
        install: manifest.requirements[id].tier === "manual" ? undefined : manifest.requirements[id].install,
        guide: r.ok ? undefined : manifest.requirements[id].guide,
        approval: manifest.requirements[id].approval,
      }])),
      blockers: ev.blockers.map((id) => ({ id, tier: manifest.requirements[id].tier })),
    }, null, 2));
    process.exit(ev.exitCode);
  }

  if (!opts.quiet) console.log(renderHuman(ev, opts));
  process.exit(ev.exitCode);
}

main();
