#!/usr/bin/env node
import fs from "node:fs";

const API = "https://api.tapd.cn";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadEnv(file) {
  const out = { ...process.env };
  if (!file) return out;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function form(data, includeEmpty = false) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (value === "" && !includeEmpty) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(`${key}[]`, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

function required(values, keys) {
  for (const key of keys) {
    if (!values[key]) throw new Error(`missing ${key}`);
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = /token|secret|password/i.test(key) ? "[redacted]" : redact(val);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const COMMANDS = new Set([
  "token-check", "workspace", "iteration", "users", "validate-owner", "workitem-types",
  "list-tasks", "daily-hours", "create-task", "update-task", "add-timesheet",
]);
const TASK_STATUSES = new Set(["open", "progressing", "done", "deleted"]);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateArgs(command, args, env, workspaceId) {
  if (workspaceId && !/^\d+$/.test(String(workspaceId))) throw new Error("workspace-id must contain digits only");
  for (const key of ["begin", "due", "spentdate"]) {
    if (args[key] && !validDate(args[key])) throw new Error(`--${key} must be a real date in YYYY-MM-DD format`);
  }
  if (args.begin && args.due && args.due < args.begin) throw new Error("--due must not be earlier than --begin");
  if (args.status && !TASK_STATUSES.has(args.status)) {
    throw new Error(`--status must be one of: ${[...TASK_STATUSES].join(", ")}`);
  }
  if (args.timespent !== undefined) {
    const value = Number(args.timespent);
    if (!Number.isFinite(value) || value <= 0) throw new Error("--timespent must be a positive number");
  }
  if (command === "users" && !args.search && !args["exact-user"] && !args.all) {
    throw new Error("users needs --search <姓名>, --exact-user <完整user>, or explicit --all");
  }
  if (command === "validate-owner") required({ TAPD_DEFAULT_OWNER: env.TAPD_DEFAULT_OWNER }, ["TAPD_DEFAULT_OWNER"]);
  if (command === "update-task") {
    const fields = ["name", "story-id", "iteration-id", "status", "owner", "begin", "due", "effort", "priority", "priority-label", "description"];
    if (!fields.some((key) => args[key] !== undefined)) throw new Error("update-task needs at least one field to change");
  }
}

async function getToken(env) {
  required(env, ["TAPD_CLIENT_ID", "TAPD_CLIENT_SECRET"]);
  const auth = Buffer.from(`${env.TAPD_CLIENT_ID}:${env.TAPD_CLIENT_SECRET}`).toString("base64");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(`${API}/tokens/request_token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form({ grant_type: "client_credentials" }),
    });
    const json = await res.json();
    if (json.status === 1 && json.data?.access_token) return json.data.access_token;
    if (json.error_msg === "Too Many Requests" && attempt < 6) {
      await sleep(5000 * attempt);
      continue;
    }
    throw new Error(JSON.stringify(redact(json)));
  }
}

async function getJson(accessToken, path, query = {}) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (json.status === 1) return json;
    if (json.error_msg === "Too Many Requests" && attempt < 6) {
      await sleep(5000 * attempt);
      continue;
    }
    throw new Error(JSON.stringify(redact(json)));
  }
}

async function postJson(accessToken, path, data, includeEmpty = false) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form(data, includeEmpty),
    });
    const json = await res.json();
    if (json.status === 1) return json;
    if (json.error_msg === "Too Many Requests" && attempt < 6) {
      await sleep(5000 * attempt);
      continue;
    }
    throw new Error(JSON.stringify(redact(json)));
  }
}

async function listTasks(accessToken, workspaceId, iterationId, prefix = "") {
  const json = await getJson(accessToken, "/tasks", {
    workspace_id: workspaceId,
    iteration_id: iterationId,
    limit: 200,
    fields: "id,name,status,story_id,begin,due,effort,effort_completed,owner",
  });
  return (json.data || [])
    .map((row) => row.Task)
    .filter(Boolean)
    .filter((task) => task.status !== "deleted")
    .filter((task) => !prefix || String(task.name || "").startsWith(prefix));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const env = loadEnv(args["env-file"]);
  const workspaceId = args["workspace-id"] || env.TAPD_WORKSPACE_ID;

  if (!command || command === "help") {
    console.log(`Commands: ${[...COMMANDS].join(", ")}`);
    return;
  }

  if (!COMMANDS.has(command)) throw new Error(`unknown command: ${command}`);
  validateArgs(command, args, env, workspaceId);

  const accessToken = await getToken(env);

  if (command === "token-check") {
    console.log(JSON.stringify({ status: "ok", has_access_token: true }, null, 2));
    return;
  }

  if (command === "workspace") {
    required({ TAPD_WORKSPACE_ID: workspaceId }, ["TAPD_WORKSPACE_ID"]);
    const json = await getJson(accessToken, "/workspaces/get_workspace_info", { workspace_id: workspaceId });
    const ws = json.data?.Workspace;
    console.log(JSON.stringify({ status: json.status, info: json.info, workspace: ws && { id: ws.id, name: ws.name, status: ws.status } }, null, 2));
    return;
  }

  if (command === "iteration") {
    required({ TAPD_WORKSPACE_ID: workspaceId, iteration_id: args["iteration-id"] }, ["TAPD_WORKSPACE_ID", "iteration_id"]);
    const json = await getJson(accessToken, "/iterations", { workspace_id: workspaceId, id: args["iteration-id"] });
    console.log(JSON.stringify(json.data || [], null, 2));
    return;
  }

  if (command === "users") {
    required({ TAPD_WORKSPACE_ID: workspaceId }, ["TAPD_WORKSPACE_ID"]);
    const json = await getJson(accessToken, "/workspaces/users", {
      workspace_id: workspaceId,
      user: args["exact-user"],
    });
    let rows = (json.data || []).map((row) => row.UserWorkspace).filter(Boolean);
    if (args["exact-user"]) rows = rows.filter((u) => u.user === args["exact-user"]);
    else if (args.search) {
      const query = String(args.search).toLowerCase();
      rows = rows.filter((u) => [u.user, u.name].some((v) => String(v ?? "").toLowerCase().includes(query)));
    }
    console.log(JSON.stringify(rows.map((u) => ({
      user: u.user,
      name: u.name,
      ...(args["include-email"] ? { email: u.email } : {}),
      status: u.status,
    })), null, 2));
    return;
  }

  if (command === "validate-owner") {
    required({ TAPD_WORKSPACE_ID: workspaceId }, ["TAPD_WORKSPACE_ID"]);
    const json = await getJson(accessToken, "/workspaces/users", {
      workspace_id: workspaceId,
      user: env.TAPD_DEFAULT_OWNER,
    });
    const rows = (json.data || []).map((row) => row.UserWorkspace).filter(Boolean);
    const match = rows.find((u) => u.user === env.TAPD_DEFAULT_OWNER);
    if (!match) throw new Error("TAPD_DEFAULT_OWNER does not exactly match any UserWorkspace.user in this project; run users --search <姓名> and copy the user field");
    console.log(JSON.stringify({ valid_owner: true, user: match.user, status: match.status }, null, 2));
    return;
  }

  if (command === "workitem-types") {
    required({ TAPD_WORKSPACE_ID: workspaceId }, ["TAPD_WORKSPACE_ID"]);
    const json = await getJson(accessToken, "/workitem_types", { workspace_id: workspaceId, limit: 200 });
    const rows = (json.data || []).map((row) => row.WorkitemType).filter(Boolean);
    console.log(JSON.stringify(rows.map((t) => ({ id: t.id, name: t.name, english_name: t.english_name, entity_type: t.entity_type, status: t.status })), null, 2));
    return;
  }

  if (command === "list-tasks") {
    required({ TAPD_WORKSPACE_ID: workspaceId, iteration_id: args["iteration-id"] }, ["TAPD_WORKSPACE_ID", "iteration_id"]);
    console.log(JSON.stringify(await listTasks(accessToken, workspaceId, args["iteration-id"], args.prefix || ""), null, 2));
    return;
  }

  if (command === "daily-hours") {
    required({ TAPD_WORKSPACE_ID: workspaceId, iteration_id: args["iteration-id"] }, ["TAPD_WORKSPACE_ID", "iteration_id"]);
    const tasks = await listTasks(accessToken, workspaceId, args["iteration-id"], args.prefix || "");
    const daily = {};
    let total = 0;
    let timesheetCount = 0;
    for (const task of tasks) {
      const json = await getJson(accessToken, "/timesheets", { workspace_id: workspaceId, entity_type: "task", entity_id: task.id, limit: 200 });
      for (const row of json.data || []) {
        const sheet = row.Timesheet;
        if (!sheet) continue;
        const hours = Number(sheet.timespent || 0);
        daily[sheet.spentdate] = (daily[sheet.spentdate] || 0) + hours;
        total += hours;
        timesheetCount += 1;
      }
    }
    const sorted = Object.fromEntries(Object.entries(daily).sort());
    console.log(JSON.stringify({
      task_count: tasks.length,
      timesheet_count: timesheetCount,
      total_timespent: total,
      daily: sorted,
      over8: Object.fromEntries(Object.entries(sorted).filter(([, hours]) => hours > 8)),
    }, null, 2));
    return;
  }

  if (command === "create-task") {
    required({ TAPD_WORKSPACE_ID: workspaceId, name: args.name }, ["TAPD_WORKSPACE_ID", "name"]);
    const json = await postJson(accessToken, "/tasks", {
      workspace_id: workspaceId,
      iteration_id: args["iteration-id"],
      story_id: args["story-id"],
      name: args.name,
      owner: args.owner || env.TAPD_DEFAULT_OWNER,
      begin: args.begin,
      due: args.due,
      effort: args.effort || "0",
      status: args.status,
      description: args.description,
    });
    console.log(JSON.stringify({ task: json.data?.Task }, null, 2));
    return;
  }

  if (command === "update-task") {
    required({ TAPD_WORKSPACE_ID: workspaceId, task_id: args["task-id"] }, ["TAPD_WORKSPACE_ID", "task_id"]);
    const json = await postJson(accessToken, "/tasks", {
      workspace_id: workspaceId,
      id: args["task-id"],
      current_user: args["current-user"] || env.TAPD_DEFAULT_OWNER,
      name: args.name,
      story_id: args["story-id"],
      iteration_id: args["iteration-id"],
      status: args.status,
      owner: args.owner,
      begin: args.begin,
      due: args.due,
      effort: args.effort,
      priority: args.priority,
      priority_label: args["priority-label"],
      description: args.description,
    }, true);
    console.log(JSON.stringify({ task: json.data?.Task || json.data }, null, 2));
    return;
  }

  if (command === "add-timesheet") {
    required({
      TAPD_WORKSPACE_ID: workspaceId,
      task_id: args["task-id"],
      spentdate: args.spentdate,
      timespent: args.timespent,
    }, ["TAPD_WORKSPACE_ID", "task_id", "spentdate", "timespent"]);
    const json = await postJson(accessToken, "/timesheets", {
      workspace_id: workspaceId,
      entity_type: "task",
      entity_id: args["task-id"],
      owner: args.owner || env.TAPD_DEFAULT_OWNER,
      timespent: args.timespent,
      spentdate: args.spentdate,
      memo: args.memo,
    });
    console.log(JSON.stringify({ timesheet: json.data?.Timesheet }, null, 2));
    return;
  }

}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
