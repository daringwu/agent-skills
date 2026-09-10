import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const tool = fileURLToPath(new URL("../scripts/tapd_tool.mjs", import.meta.url));
const updateCheck = fileURLToPath(new URL("../scripts/check-update.mjs", import.meta.url));
const tasks = [{ id: "1", name: "Existing Task", status: "open", iteration_id: "10", story_id: "20", owner: "alice", effort: "0" }];
const sheets = [];
let nextTask = 2;
let nextSheet = 100;

function body(req) {
  return new Promise((resolve) => {
    let value = "";
    req.on("data", (chunk) => { value += chunk; });
    req.on("end", () => resolve(new URLSearchParams(value)));
  });
}

function ok(res, data) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: 1, data }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/tokens/request_token") return ok(res, { access_token: "secret" });
  if (url.pathname === "/tasks" && req.method === "GET") {
    const rows = tasks.filter((task) => !url.searchParams.get("id") || task.id === url.searchParams.get("id"));
    return ok(res, rows.map((Task) => ({ Task })));
  }
  if (url.pathname === "/tasks" && req.method === "POST") {
    const form = await body(req);
    let task = tasks.find((row) => row.id === form.get("id"));
    if (!task) {
      task = { id: String(nextTask++) };
      tasks.push(task);
    }
    for (const [key, value] of form) if (!key.endsWith("[]") && key !== "workspace_id" && key !== "current_user") task[key] = value;
    return ok(res, { Task: task });
  }
  if (url.pathname === "/timesheets" && req.method === "GET") {
    const rows = sheets.filter((row) => [...url.searchParams].every(([key, value]) => ["workspace_id", "limit", "page"].includes(key) || String(row[key]) === value));
    return ok(res, rows.map((Timesheet) => ({ Timesheet })));
  }
  if (url.pathname === "/timesheets" && req.method === "POST") {
    const form = await body(req);
    const sheet = { id: String(nextSheet++) };
    for (const [key, value] of form) if (key !== "workspace_id") sheet[key] = value;
    sheets.push(sheet);
    return ok(res, { Timesheet: sheet });
  }
  if (url.pathname === "/timesheets/delete_timesheets" && req.method === "POST") {
    const form = await body(req);
    const ids = form.getAll("cost_ids[]");
    for (let i = sheets.length - 1; i >= 0; i -= 1) if (ids.includes(sheets[i].id)) sheets.splice(i, 1);
    return ok(res, {});
  }
  res.statusCode = 404;
  ok(res, {});
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const api = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, TAPD_API_BASE_URL: api, TAPD_CLIENT_ID: "id", TAPD_CLIENT_SECRET: "secret", TAPD_WORKSPACE_ID: "9", TAPD_DEFAULT_OWNER: "alice" };
async function run(...args) {
  return exec(process.execPath, [tool, ...args], { env });
}

test("blocks normalized duplicate task", async () => {
  await assert.rejects(run("create-task", "--iteration-id", "10", "--story-id", "20", "--name", " existing   task "), /normalized duplicate/);
});

test("creates and verifies task", async () => {
  const { stdout } = await run("create-task", "--iteration-id", "10", "--story-id", "20", "--name", "New Task");
  assert.equal(JSON.parse(stdout).status, "created_and_verified");
});

test("rounding requires confirmation then writes and verifies", async () => {
  await assert.rejects(run("add-timesheet", "--task-id", "2", "--spentdate", "2026-09-10", "--timespent", "1.2"), /rounds to 1/);
  const { stdout } = await run("add-timesheet", "--task-id", "2", "--spentdate", "2026-09-10", "--timespent", "1.2", "--confirm");
  const result = JSON.parse(stdout);
  assert.equal(result.timesheet.timespent, "1");
  assert.equal(result.task_synced.status, "progressing");
  assert.equal(result.task_synced.begin, "2026-09-10");
});

test("blocks same task and day conflict", async () => {
  await assert.rejects(run("add-timesheet", "--task-id", "2", "--spentdate", "2026-09-10", "--timespent", "1"), /existing same-task same-day/);
});

test("delete needs confirmation and verifies deletion", async () => {
  await assert.rejects(run("delete-timesheets", "--entity-id", "2", "--cost-ids", "100"), /requires confirmation/);
  const { stdout } = await run("delete-timesheets", "--entity-id", "2", "--cost-ids", "100", "--confirm");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "deleted_and_verified");
  assert.equal(result.task_synced.status, "open");
});

test("loads the default cross-platform config directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapd-config-test-"));
  const directory = path.join(root, "tapd-openapi-workflow");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "env"), "TAPD_CLIENT_ID=id\nTAPD_CLIENT_SECRET=secret\nTAPD_WORKSPACE_ID=9\n");
  const cleanEnv = { ...process.env, TAPD_API_BASE_URL: api, AGENT_SKILLS_HOME: root };
  delete cleanEnv.TAPD_CLIENT_ID;
  delete cleanEnv.TAPD_CLIENT_SECRET;
  delete cleanEnv.TAPD_WORKSPACE_ID;
  const { stdout } = await exec(process.execPath, [tool, "token-check"], { env: cleanEnv });
  assert.equal(JSON.parse(stdout).has_access_token, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("update check gives an Agent-neutral executable update method", async () => {
  const updateServer = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ version: "9.0.0" }));
  });
  await new Promise((resolve) => updateServer.listen(0, "127.0.0.1", resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tapd-update-test-"));
  const { stdout } = await exec(process.execPath, [updateCheck], { env: { ...process.env, AGENT_SKILLS_HOME: root, TAPD_VERSION_URL: `http://127.0.0.1:${updateServer.address().port}/version.json`, TAPD_UPDATE_CACHE_MS: "0" } });
  assert.match(stdout, /2\.1\.0 → 9\.0\.0/);
  assert.match(stdout, /install-skill-from-github\.mjs/);
  await new Promise((resolve) => updateServer.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test.after(() => server.close());
