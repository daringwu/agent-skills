#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PREFLIGHT = path.join(SCRIPT_DIR, "preflight.mjs");
const UPDATE_CHECK = path.join(SCRIPT_DIR, "check-update.mjs");
const PKG = process.env.LARK_CLI_PKG || "@larksuite/cli@1.0.90";
const HIGH_RISK = new Set(["overwrite", "block_delete", "block_move_after"]);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function usage() {
  fail(`Usage:
  node feishu-doc.mjs fetch --doc <url-or-token> [--out outputs/name]
  node feishu-doc.mjs inspect --doc <url-or-token> [--out outputs/name]
  node feishu-doc.mjs update --doc <url-or-token> --command <command> [update flags] [--plan-out work/plan.json] [--confirm <plan-hash>] [--out outputs/name]

Update flags: --content <text|@relative-file> --pattern <text> --block-id <id>
              --start-block-id <id> --end-block-id <id> --src-block-ids <ids>
High-risk commands (overwrite, block_delete, block_move_after) preview first and exit 10.`, 2);
}

function parseArgs(argv) {
  const action = argv[0];
  if (!action || !["fetch", "inspect", "update"].includes(action)) usage();
  const values = {};
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--")) usage();
    values[key.slice(2)] = argv[++i];
  }
  if (!values.doc) usage();
  if (action === "update" && !values.command) usage();
  return { action, values };
}

function loadConfiguredEnv() {
  const root = process.env.AGENT_SKILLS_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "agent-skills");
  const envFile = path.join(root, "feishu-doc-access", "env");
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith("#") || !text.includes("=")) continue;
      const index = text.indexOf("=");
      const key = text.slice(0, index).trim();
      let value = text.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[key] = value;
    }
  } catch { /* preflight reports a missing file/value */ }
  return env;
}

function runGate(env) {
  try { execFileSync(process.execPath, [UPDATE_CHECK], { env, stdio: ["ignore", "inherit", "ignore"], timeout: 5000 }); } catch { /* non-blocking */ }
  try {
    execFileSync(process.execPath, [PREFLIGHT, "--capability", "user-oauth-read", "--quiet"], { env, stdio: "ignore", timeout: 180000 });
  } catch (error) {
    try { execFileSync(process.execPath, [PREFLIGHT, "--capability", "user-oauth-read"], { env, stdio: "inherit", timeout: 180000 }); } catch { /* rendered by preflight */ }
    process.exit(typeof error.status === "number" ? error.status : 20);
  }
}

function cli(env, args) {
  let text;
  try {
    text = execFileSync("npx", ["-y", PKG, "--profile", env.LARK_PROFILE, ...args, "--as", "user", "--format", "json"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180000,
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    fail(output || error.message);
  }
  let result;
  try { result = JSON.parse(text); } catch { fail("lark-cli 返回了无法解析的 JSON"); }
  if (result.ok !== true) fail(JSON.stringify(result, null, 2));
  if (result.identity && result.identity !== "user") fail(`身份校验失败：期望 user，实际 ${result.identity}`);
  return result;
}

function safeBase(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "feishu-doc";
}

function outputPrefix(values, suffix) {
  return path.resolve(values.out || path.join("outputs", `${safeBase(suffix)}-${Date.now()}`));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashPlan(plan) {
  return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

function updateArgs(values) {
  const args = ["docs", "+update", "--doc", values.doc, "--command", values.command];
  for (const key of ["content", "pattern", "block-id", "start-block-id", "end-block-id", "src-block-ids"]) {
    if (values[key] !== undefined) args.push(`--${key}`, values[key]);
  }
  return args;
}

function fetchedContent(result) {
  return result.data?.document?.content ?? result.data?.content ?? "";
}

function fetchFull(env, doc) {
  return cli(env, ["docs", "+fetch", "--doc", doc, "--scope", "full", "--detail", "full", "--doc-format", "xml"]);
}

function main() {
  const { action, values } = parseArgs(process.argv.slice(2));
  const env = loadConfiguredEnv();
  runGate(env);

  if (action === "fetch") {
    const result = cli(env, ["docs", "+fetch", "--doc", values.doc, "--scope", "full", "--detail", "simple", "--doc-format", "markdown"]);
    const prefix = outputPrefix(values, "fetch");
    writeJson(`${prefix}.json`, result);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(`${prefix}.md`, fetchedContent(result), "utf8");
    console.log(JSON.stringify({ status: "read_and_saved", json: `${prefix}.json`, markdown: `${prefix}.md` }, null, 2));
    return;
  }

  if (action === "inspect") {
    const result = cli(env, ["drive", "+inspect", "--url", values.doc]);
    const prefix = outputPrefix(values, "inspect");
    writeJson(`${prefix}.json`, result);
    console.log(JSON.stringify({ status: "inspected", json: `${prefix}.json` }, null, 2));
    return;
  }

  const before = fetchFull(env, values.doc);
  const plan = {
    schemaVersion: 1,
    action: "update",
    risk: HIGH_RISK.has(values.command) ? "high" : "ordinary",
    doc: values.doc,
    command: values.command,
    parameters: Object.fromEntries(Object.entries(values).filter(([key]) => !["doc", "command", "confirm", "plan-out", "out"].includes(key))),
    beforeRevision: before.data?.document?.revision_id ?? before.data?.revision_id ?? null,
  };
  plan.hash = hashPlan(plan);
  const planFile = path.resolve(values["plan-out"] || path.join("work", `feishu-plan-${plan.hash}.json`));
  writeJson(planFile, plan);

  if (plan.risk === "high" && values.confirm !== plan.hash) {
    console.log(JSON.stringify({ status: "confirmation_required", plan: planFile, confirmation: plan.hash, preview: plan }, null, 2));
    process.exit(10);
  }

  if (plan.risk === "high") {
    const snapshotPrefix = outputPrefix(values, `snapshot-${plan.hash}`);
    writeJson(`${snapshotPrefix}.before.json`, before);
    fs.writeFileSync(`${snapshotPrefix}.before.xml`, fetchedContent(before), "utf8");
  }

  const updated = cli(env, updateArgs(values));
  const after = fetchFull(env, values.doc);
  const beforeRevision = plan.beforeRevision;
  const afterRevision = after.data?.document?.revision_id ?? after.data?.revision_id ?? null;
  if (beforeRevision !== null && afterRevision !== null && String(beforeRevision) === String(afterRevision)) {
    fail("写入后 revision 未变化；已停止，不会盲目重试");
  }
  const prefix = outputPrefix(values, `update-${plan.hash}`);
  writeJson(`${prefix}.json`, { status: "updated_and_verified", plan, updated, after });
  console.log(JSON.stringify({ status: "updated_and_verified", plan: planFile, result: `${prefix}.json`, revision: afterRevision }, null, 2));
}

main();
