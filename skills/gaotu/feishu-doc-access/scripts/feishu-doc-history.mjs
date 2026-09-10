#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const POLICY = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, "policies", "policy.json"), "utf8"));

function usage() {
  console.error(`Usage:
  node feishu-doc-history.mjs --doc <url-or-token> --out <output-prefix> [--profile <profile>] [--page-size 20] [--timezone Asia/Shanghai] [--confirm-overwrite]

Examples:
  node feishu-doc-history.mjs --doc 'https://<your-org>.feishu.cn/wiki/<token>' --profile <profile> --out outputs/doc-history
  node feishu-doc-history.mjs --doc docxToken --out work/history --timezone Asia/Shanghai
`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
    if (key === "confirm-overwrite") { args[key] = true; continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();
    args[key] = value;
    i += 1;
  }
  if (!args.doc || !args.out) usage();
  return {
    doc: args.doc,
    out: args.out,
    profile: args.profile ?? "",
    pageSize: String(args["page-size"] ?? "20"),
    timezone: args.timezone ?? POLICY.rules.timezone.value,
    confirmOverwrite: args["confirm-overwrite"] === true,
  };
}

function loadEnv() {
  const root = process.env.AGENT_SKILLS_HOME || path.join(os.homedir(), ".config", "agent-skills");
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(root, "feishu-doc-access", "env"), "utf8").split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith("#") || !text.includes("=")) continue;
      const index = text.indexOf("=");
      let value = text.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[text.slice(0, index).trim()] = value;
    }
  } catch { /* preflight gives the actionable error */ }
  return env;
}

function runGate(env) {
  try { execFileSync(process.execPath, [path.join(SCRIPT_DIR, "check-update.mjs")], { env, stdio: ["ignore", "inherit", "ignore"], timeout: 5000 }); } catch { /* non-blocking */ }
  try {
    execFileSync(process.execPath, [path.join(SCRIPT_DIR, "preflight.mjs"), "--capability", "user-oauth-read", "--quiet"], { env, stdio: "ignore", timeout: 180000 });
  } catch (error) {
    try { execFileSync(process.execPath, [path.join(SCRIPT_DIR, "preflight.mjs"), "--capability", "user-oauth-read"], { env, stdio: "inherit", timeout: 180000 }); } catch { /* rendered */ }
    process.exit(typeof error.status === "number" ? error.status : 20);
  }
}

function runHistoryPage({ doc, profile, pageSize, pageToken }, env) {
  const args = ["-y", process.env.LARK_CLI_PKG || "@larksuite/cli@1.0.90"];
  if (profile) args.push("--profile", profile);
  args.push("docs", "+history-list", "--as", "user", "--doc", doc, "--page-size", pageSize, "--format", "json");
  if (pageToken) args.push("--page-token", pageToken);
  const text = execFileSync("npx", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const result = JSON.parse(text);
  if (result.identity && result.identity !== "user") throw new Error(`身份校验失败：期望 user，实际 ${result.identity}`);
  return result;
}

function dedupe(entries) {
  const seen = new Set();
  const output = [];
  for (const entry of entries) {
    const key = `${entry.history_version_id}|${entry.revision_id}|${entry.edit_time}|${(entry.editor_ids ?? []).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function summarize(entries, timezone) {
  const byDay = new Map();
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (const entry of entries) {
    const local = formatter.format(new Date(entry.edit_time));
    const day = local.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, {
        count: 0,
        editors: new Set(),
        minRevision: Infinity,
        maxRevision: -Infinity,
        firstMs: Infinity,
        lastMs: -Infinity,
      });
    }
    const row = byDay.get(day);
    row.count += 1;
    for (const id of entry.editor_ids ?? []) row.editors.add(id);
    const revision = Number(entry.revision_id);
    if (Number.isFinite(revision)) {
      row.minRevision = Math.min(row.minRevision, revision);
      row.maxRevision = Math.max(row.maxRevision, revision);
    }
    const timestamp = new Date(entry.edit_time).getTime();
    row.firstMs = Math.min(row.firstMs, timestamp);
    row.lastMs = Math.max(row.lastMs, timestamp);
  }
  const fmt = (ms) => formatter.format(new Date(ms));
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, row]) => ({
      day,
      count: row.count,
      editors: [...row.editors],
      revision_range:
        row.minRevision === Infinity ? "" : `${row.minRevision}-${row.maxRevision}`,
      first_local: fmt(row.firstMs),
      last_local: fmt(row.lastMs),
      timezone,
    }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  options.profile ||= env.LARK_PROFILE || "";
  const targets = [`${options.out}-all.json`, `${options.out}-daily-summary.json`];
  const existing = targets.filter((file) => fs.existsSync(file));
  if (existing.length && !options.confirmOverwrite) {
    console.log(JSON.stringify({ status: "confirmation_required", risk: "overwrite-local-output", targets: existing, confirm: "--confirm-overwrite" }, null, 2));
    process.exit(10);
  }
  runGate(env);
  const entries = [];
  let pageToken = "";
  let page = 0;
  while (true) {
    const json = runHistoryPage({ ...options, pageToken }, env);
    if (!json.ok) throw new Error(JSON.stringify(json, null, 2));
    const pageEntries = json.data?.entries ?? [];
    entries.push(...pageEntries);
    page += 1;
    console.error(`page ${page}: ${pageEntries.length}`);
    if (!json.data?.has_more) break;
    pageToken = json.data.page_token;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const uniqueEntries = dedupe(entries);
  const summary = summarize(uniqueEntries, options.timezone);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(`${options.out}-all.json`, JSON.stringify({ ok: true, doc: options.doc, entries: uniqueEntries }, null, 2));
  fs.writeFileSync(`${options.out}-daily-summary.json`, JSON.stringify({ ok: true, doc: options.doc, total: uniqueEntries.length, summary }, null, 2));
  console.log(JSON.stringify({ total: uniqueEntries.length, all: `${options.out}-all.json`, daily: `${options.out}-daily-summary.json` }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
