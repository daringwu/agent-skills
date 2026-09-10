import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const skill = fileURLToPath(new URL("..", import.meta.url));
const tool = path.join(skill, "scripts", "feishu-doc.mjs");
const historyTool = path.join(skill, "scripts", "feishu-doc-history.mjs");
const statusTool = path.join(skill, "scripts", "checks", "lark-status.mjs");
const updateCheck = path.join(skill, "scripts", "check-update.mjs");
const preflight = path.join(skill, "scripts", "preflight.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-doc-test-"));
const bin = path.join(temp, "bin");
const config = path.join(temp, "config");
const workspace = path.join(temp, "workspace");
const stateFile = path.join(temp, "revision.txt");
const argvFile = path.join(temp, "argv.json");
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(config, "feishu-doc-access"), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(config, "feishu-doc-access", "env"), "LARK_PROFILE=test-user\n", { mode: 0o600 });
fs.writeFileSync(stateFile, "1");

const fake = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.ARGV_FILE, JSON.stringify(args));
if (args.includes("--version")) { console.log("1.0.90"); process.exit(0); }
if (args.includes("auth") && args.includes("status")) {
  console.log(JSON.stringify({brand:"feishu",identities:{user:{available:true,status:"valid",userName:"Tester"}}})); process.exit(0);
}
const revision = Number(fs.readFileSync(process.env.REVISION_FILE, "utf8"));
if (args.includes("+fetch")) {
  console.log(JSON.stringify({ok:true,identity:"user",data:{document:{revision_id:revision,content:"<doc><p>revision "+revision+"</p></doc>"}}})); process.exit(0);
}
if (args.includes("+inspect")) {
  console.log(JSON.stringify({ok:true,identity:"user",data:{type:"docx",token:"docx_test"}})); process.exit(0);
}
if (args.includes("+history-list")) {
  console.log(JSON.stringify({ok:true,identity:"user",data:{entries:[{history_version_id:"1",revision_id:1,edit_time:"2026-09-10T16:30:00Z",editor_ids:["ou_test"]}],has_more:false}})); process.exit(0);
}
if (args.includes("+update")) {
  fs.writeFileSync(process.env.REVISION_FILE, String(revision + 1));
  console.log(JSON.stringify({ok:true,identity:"user",data:{result:"success",document:{revision_id:revision+1}}})); process.exit(0);
}
console.error("unexpected args: "+JSON.stringify(args)); process.exit(1);
`;
const fakePath = path.join(bin, process.platform === "win32" ? "npx.cmd" : "npx");
if (process.platform === "win32") {
  fs.writeFileSync(fakePath, `@echo off\r\n"${process.execPath}" "${path.join(bin, "fake-npx.cjs")}" %*\r\n`);
  fs.writeFileSync(path.join(bin, "fake-npx.cjs"), fake);
} else {
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  AGENT_SKILLS_HOME: config,
  REVISION_FILE: stateFile,
  ARGV_FILE: argvFile,
  FEISHU_VERSION_URL: "http://127.0.0.1:1/version.json",
  FEISHU_UPDATE_TIMEOUT_MS: "20",
};

async function run(...args) {
  return exec(process.execPath, [tool, ...args], { env, cwd: workspace });
}

test("fetch passes user identity and saves JSON plus Markdown", async () => {
  const { stdout } = await run("fetch", "--doc", "docx_test", "--out", "outputs/read");
  assert.equal(JSON.parse(stdout).status, "read_and_saved");
  assert.match(fs.readFileSync(path.join(workspace, "outputs", "read.md"), "utf8"), /revision 1/);
  const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  assert.ok(argv.includes("user"));
});

test("ordinary targeted update executes and verifies without confirmation", async () => {
  const { stdout } = await run("update", "--doc", "docx_test", "--command", "str_replace", "--pattern", "old", "--content", "new", "--out", "outputs/ordinary");
  assert.equal(JSON.parse(stdout).status, "updated_and_verified");
  assert.equal(fs.readFileSync(stateFile, "utf8"), "2");
});

test("high-risk update previews, snapshots, confirms, and verifies", async () => {
  let error;
  try {
    await run("update", "--doc", "docx_test", "--command", "overwrite", "--content", "replacement", "--plan-out", "work/overwrite.json", "--out", "outputs/high-risk");
  } catch (value) { error = value; }
  assert.equal(error?.code, 10);
  const preview = JSON.parse(error.stdout);
  assert.equal(preview.status, "confirmation_required");
  assert.equal(fs.readFileSync(stateFile, "utf8"), "2");

  const { stdout } = await run("update", "--doc", "docx_test", "--command", "overwrite", "--content", "replacement", "--plan-out", "work/overwrite.json", "--confirm", preview.confirmation, "--out", "outputs/high-risk");
  assert.equal(JSON.parse(stdout).status, "updated_and_verified");
  assert.equal(fs.readFileSync(stateFile, "utf8"), "3");
  assert.ok(fs.existsSync(path.join(workspace, `outputs`, `high-risk.before.xml`)));
});

test("profile value is passed as one argument, not interpreted by a shell", async () => {
  const marker = path.join(temp, "injected");
  await exec(process.execPath, [statusTool, "--mode", "user"], {
    env: { ...env, LARK_PROFILE: `profile;touch ${marker}` },
  });
  assert.equal(fs.existsSync(marker), false);
  const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  assert.ok(argv.includes(`profile;touch ${marker}`));
});

test("history uses policy timezone and refuses silent overwrite", async () => {
  const first = await exec(process.execPath, [historyTool, "--doc", "docx_test", "--out", "outputs/history"], { env, cwd: workspace });
  assert.equal(JSON.parse(first.stdout).total, 1);
  const summary = JSON.parse(fs.readFileSync(path.join(workspace, "outputs", "history-daily-summary.json"), "utf8"));
  assert.equal(summary.identity, "user");
  assert.equal(summary.page_count, 1);
  assert.equal(summary.has_more, false);
  assert.equal(summary.pagination_complete, true);
  assert.equal(summary.timezone, "Asia/Shanghai");
  assert.equal(summary.summary[0].day, "2026-09-11");
  assert.equal(summary.summary[0].timezone, "Asia/Shanghai");
  await assert.rejects(
    exec(process.execPath, [historyTool, "--doc", "docx_test", "--out", "outputs/history"], { env, cwd: workspace }),
    (error) => error.code === 10 && /confirmation_required/.test(error.stdout),
  );
});

test("preflight in an isolated first-use config reports only actionable missing setup", async () => {
  const isolatedConfig = path.join(temp, "isolated-first-use");
  let error;
  try {
    await exec(process.execPath, [preflight, "--capability", "user-oauth-read", "--no-cache", "--json"], {
      env: { ...env, AGENT_SKILLS_HOME: isolatedConfig, LARK_PROFILE: "" }, cwd: workspace,
    });
  } catch (value) { error = value; }
  assert.equal(error?.code, 20);
  const report = JSON.parse(error.stdout);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.requirements["lark-profile-name"].ok, false);
  assert.equal(report.requirements["lark-profile-name"].skipped, false);
  assert.equal(report.requirements["lark-profile"].skipped, true);
  assert.equal(report.requirements["lark-user-identity"].skipped, true);
  assert.match(JSON.stringify(report), /config init/);
  assert.match(JSON.stringify(report), /feishu-doc-access/);
});

test("update check reports a newer version and stays silent offline", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version: "9.0.0" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/version.json`;
  const freshConfig = path.join(temp, "update-config");
  const result = await exec(process.execPath, [updateCheck], { env: { ...env, AGENT_SKILLS_HOME: freshConfig, FEISHU_VERSION_URL: url, FEISHU_UPDATE_CACHE_MS: "0" } });
  assert.match(result.stdout, /2\.1\.0 → 9\.0\.0/);
  assert.match(result.stdout, /install-skill-from-github\.mjs/);
  await new Promise((resolve) => server.close(resolve));
  const offline = await exec(process.execPath, [updateCheck], { env: { ...env, AGENT_SKILLS_HOME: path.join(temp, "offline-config"), FEISHU_VERSION_URL: "http://127.0.0.1:1/version.json", FEISHU_UPDATE_TIMEOUT_MS: "20" } });
  assert.equal(offline.stdout, "");
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
