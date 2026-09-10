#!/usr/bin/env node

// Best-effort update check. It never installs, changes the skill, or fails its caller.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = path.join(SKILL_DIR, "version.json");
const CONFIG_ROOT = process.env.AGENT_SKILLS_HOME || path.join(os.homedir(), ".config", "agent-skills");
const CACHE_FILE = path.join(CONFIG_ROOT, "feishu-doc-access", "update-check.json");
const CACHE_MS = Number(process.env.FEISHU_UPDATE_CACHE_MS ?? 86400000);
const TIMEOUT_MS = Number(process.env.FEISHU_UPDATE_TIMEOUT_MS ?? 3000);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function isNewer(remote, local) {
  const parse = (value) => String(value).split(".").map(Number);
  const a = parse(remote);
  const b = parse(local);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function writeCache(value) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  } catch { /* optional cache */ }
}

async function main() {
  const local = readJson(VERSION_FILE);
  if (!local?.version || !local.repository || !local.path || !local.ref) return;
  const cached = readJson(CACHE_FILE);
  let remoteVersion = cached?.remoteVersion;
  if (!cached?.checkedAt || Date.now() - cached.checkedAt > CACHE_MS) {
    const repo = local.repository.replace(/\/$/, "").replace("https://github.com/", "");
    const url = process.env.FEISHU_VERSION_URL || `https://raw.githubusercontent.com/${repo}/${local.ref}/${local.path}/version.json`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return;
      remoteVersion = (await response.json()).version;
      writeCache({ checkedAt: Date.now(), remoteVersion });
    } catch { return; }
  }
  if (!isNewer(remoteVersion, local.version)) return;
  console.log(`⬆ feishu-doc-access 有新版：${local.version} → ${remoteVersion}`);
  console.log(`来源：${local.repository}/tree/${local.ref}/${local.path}`);
  console.log("通用更新器：https://raw.githubusercontent.com/daringwu/agent-skills/main/tools/install-skill-from-github.mjs");
  console.log(`更新命令：node install-skill-from-github.mjs --repo daringwu/agent-skills --ref ${local.ref} --path ${local.path} --dest "${SKILL_DIR}"`);
  console.log(`配置保留在：${local.configDir}；版本检查不阻塞当前任务。`);
}

main().catch(() => {});
