#!/usr/bin/env node
import fs from "node:fs";

const API = process.env.TAPD_API_BASE_URL || "https://api.tapd.cn";
const PAGE_SIZE = 200;
const WRITE_RETRY_DELAYS = [5000, 10000, 20000];

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
  "list-tasks", "get-task", "list-stories", "list-timesheets", "daily-hours",
  "create-task", "update-task", "create-story", "add-timesheet", "delete-timesheets",
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
  for (let attempt = 0; ; attempt += 1) {
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
    if ((res.status === 429 || json.error_msg === "Too Many Requests") && attempt < WRITE_RETRY_DELAYS.length) {
      await sleep(WRITE_RETRY_DELAYS[attempt]);
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
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (json.status === 1) return json;
    if ((res.status === 429 || json.error_msg === "Too Many Requests") && attempt < WRITE_RETRY_DELAYS.length) {
      await sleep(WRITE_RETRY_DELAYS[attempt]);
      continue;
    }
    throw new Error(JSON.stringify(redact(json)));
  }
}

async function postJson(accessToken, path, data, includeEmpty = false) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form(data, includeEmpty),
      });
    } catch (error) {
      throw new Error(`write result uncertain; not retried: ${error.message}`);
    }
    const json = await res.json();
    if (json.status === 1) return json;
    if ((res.status === 429 || json.error_msg === "Too Many Requests") && attempt < WRITE_RETRY_DELAYS.length) {
      await sleep(WRITE_RETRY_DELAYS[attempt]);
      continue;
    }
    throw new Error(JSON.stringify(redact(json)));
  }
}

async function getAll(accessToken, path, query = {}) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const json = await getJson(accessToken, path, { ...query, limit: PAGE_SIZE, page });
    const rows = Array.isArray(json.data) ? json.data : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function preview(action, data) {
  console.log(JSON.stringify({ dry_run: true, action, data }, null, 2));
}

function requireConfirm(args, reason) {
  if (!args.confirm) throw new Error(`${reason}; rerun with --confirm after reviewing the preview`);
}

async function listTasks(accessToken, workspaceId, iterationId, prefix = "") {
  const data = await getAll(accessToken, "/tasks", {
    workspace_id: workspaceId,
    iteration_id: iterationId,
    fields: "id,name,status,story_id,begin,due,effort,effort_completed,owner",
  });
  return data
    .map((row) => row.Task)
    .filter(Boolean)
    .filter((task) => task.status !== "deleted")
    .filter((task) => !prefix || String(task.name || "").startsWith(prefix));
}

async function taskById(accessToken, workspaceId, id) {
  const json = await getJson(accessToken, "/tasks", { workspace_id: workspaceId, id, limit: 1 });
  return (json.data || []).map((row) => row.Task).find(Boolean) || null;
}

async function timesheets(accessToken, workspaceId, query = {}) {
  const data = await getAll(accessToken, "/timesheets", { workspace_id: workspaceId, ...query });
  return data.map((row) => row.Timesheet).filter(Boolean);
}

async function syncTaskFromTimesheets(accessToken, workspaceId, taskId, currentUser) {
  const task = await taskById(accessToken, workspaceId, taskId);
  if (!task) throw new Error(`timesheet changed but task ${taskId} could not be read for synchronization`);
  const rows = await timesheets(accessToken, workspaceId, { entity_type: "task", entity_id: taskId });
  const dates = rows.map((row) => row.spentdate).filter(Boolean).sort();
  const total = rows.reduce((sum, row) => sum + Number(row.timespent || 0), 0);
  let fields;
  if (!rows.length) fields = { status: task.status === "done" ? "done" : "open", begin: "", due: "", ...(task.status === "done" ? { effort: 0 } : {}) };
  else if (task.status === "done") fields = { effort: total, begin: dates[0], due: dates.at(-1) };
  else fields = { status: "progressing", begin: dates[0], due: "" };
  await postJson(accessToken, "/tasks", { workspace_id: workspaceId, id: taskId, current_user: currentUser, ...fields }, true);
  const verified = await taskById(accessToken, workspaceId, taskId);
  for (const [key, value] of Object.entries(fields)) {
    if (String(verified?.[key] ?? "") !== String(value)) throw new Error(`timesheet changed but task synchronization readback mismatched at ${key}; no automatic rollback`);
  }
  return verified;
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

  if (command === "get-task") {
    required({ TAPD_WORKSPACE_ID: workspaceId, task_id: args["task-id"] }, ["TAPD_WORKSPACE_ID", "task_id"]);
    console.log(JSON.stringify(await taskById(accessToken, workspaceId, args["task-id"]), null, 2));
    return;
  }

  if (command === "list-stories") {
    required({ TAPD_WORKSPACE_ID: workspaceId, iteration_id: args["iteration-id"] }, ["TAPD_WORKSPACE_ID", "iteration_id"]);
    const data = await getAll(accessToken, "/stories", {
      workspace_id: workspaceId, iteration_id: args["iteration-id"],
      fields: "id,name,status,iteration_id,workitem_type_id,owner,begin,due",
    });
    console.log(JSON.stringify(data.map((row) => row.Story).filter(Boolean), null, 2));
    return;
  }

  if (command === "list-timesheets") {
    required({ TAPD_WORKSPACE_ID: workspaceId }, ["TAPD_WORKSPACE_ID"]);
    console.log(JSON.stringify(await timesheets(accessToken, workspaceId, {
      entity_type: args["entity-type"] || "task", entity_id: args["task-id"] || args["entity-id"],
      spentdate: args.spentdate, owner: args.owner,
    }), null, 2));
    return;
  }

  if (command === "daily-hours") {
    required({ TAPD_WORKSPACE_ID: workspaceId, iteration_id: args["iteration-id"] }, ["TAPD_WORKSPACE_ID", "iteration_id"]);
    const tasks = await listTasks(accessToken, workspaceId, args["iteration-id"], args.prefix || "");
    const daily = {};
    let total = 0;
    let timesheetCount = 0;
    for (const task of tasks) {
      const rows = await timesheets(accessToken, workspaceId, { entity_type: "task", entity_id: task.id });
      for (const sheet of rows) {
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
    required({ TAPD_WORKSPACE_ID: workspaceId, name: args.name, iteration_id: args["iteration-id"], story_id: args["story-id"] }, ["TAPD_WORKSPACE_ID", "name", "iteration_id", "story_id"]);
    const existing = await listTasks(accessToken, workspaceId, args["iteration-id"]);
    const duplicates = existing.filter((task) => normalizeName(task.name) === normalizeName(args.name));
    if (duplicates.length) throw new Error(`normalized duplicate task found: ${JSON.stringify(duplicates)}; choose reuse, update, or a distinct name`);
    const payload = {
      workspace_id: workspaceId, iteration_id: args["iteration-id"], story_id: args["story-id"],
      name: args.name, owner: args.owner || env.TAPD_DEFAULT_OWNER, begin: args.begin,
      due: args.due, effort: args.effort || "0", status: args.status || "open", description: args.description,
    };
    if (args["dry-run"]) return preview("create-task", payload);
    const json = await postJson(accessToken, "/tasks", {
      ...payload,
    });
    const created = json.data?.Task;
    const verified = created?.id && await taskById(accessToken, workspaceId, created.id);
    if (!verified || normalizeName(verified.name) !== normalizeName(args.name)) throw new Error(`write completed but readback verification failed; inspect task id ${created?.id || "unknown"}`);
    console.log(JSON.stringify({ status: "created_and_verified", task: verified }, null, 2));
    return;
  }

  if (command === "update-task") {
    required({ TAPD_WORKSPACE_ID: workspaceId, task_id: args["task-id"] }, ["TAPD_WORKSPACE_ID", "task_id"]);
    const before = await taskById(accessToken, workspaceId, args["task-id"]);
    if (!before) throw new Error("task not found");
    const protectedTransition = before.status === "done" && args.status === "progressing";
    const payload = {
      workspace_id: workspaceId, id: args["task-id"], current_user: args["current-user"] || env.TAPD_DEFAULT_OWNER,
      name: args.name, story_id: args["story-id"], iteration_id: args["iteration-id"], status: args.status,
      owner: args.owner, begin: args.begin, due: args.due, effort: args.effort, priority: args.priority,
      priority_label: args["priority-label"], description: args.description,
    };
    if (args.status === "done") {
      const rows = await timesheets(accessToken, workspaceId, { entity_type: "task", entity_id: args["task-id"] });
      const dates = rows.map((row) => row.spentdate).filter(Boolean).sort();
      const total = rows.reduce((sum, row) => sum + Number(row.timespent || 0), 0);
      if (args.effort !== undefined && Number(args.effort) !== total) throw new Error(`done task effort must equal final timesheet total ${total}`);
      payload.effort = total;
      payload.begin = dates[0] || "";
      payload.due = dates.at(-1) || "";
    }
    if (args["dry-run"]) return preview("update-task", { before, changes: payload });
    if (protectedTransition) requireConfirm(args, "done -> progressing is a protected transition");
    const json = await postJson(accessToken, "/tasks", {
      ...payload,
    }, true);
    const verified = await taskById(accessToken, workspaceId, args["task-id"]);
    const checks = { name: "name", status: "status", owner: "owner", begin: "begin", due: "due", effort: "effort", "story-id": "story_id", "iteration-id": "iteration_id" };
    const mismatch = Object.entries(checks).filter(([argKey, field]) => args[argKey] !== undefined && String(verified?.[field] ?? "") !== String(args[argKey]));
    if (!verified || mismatch.length) throw new Error(`write completed but readback mismatch: ${JSON.stringify(mismatch)}; state preserved, no automatic rollback`);
    console.log(JSON.stringify({ status: "updated_and_verified", before, task: verified, response: json.data }, null, 2));
    return;
  }

  if (command === "create-story") {
    required({ TAPD_WORKSPACE_ID: workspaceId, name: args.name, iteration_id: args["iteration-id"], workitem_type_id: args["workitem-type-id"] }, ["TAPD_WORKSPACE_ID", "name", "iteration_id", "workitem_type_id"]);
    const payload = { workspace_id: workspaceId, name: args.name, iteration_id: args["iteration-id"], workitem_type_id: args["workitem-type-id"], owner: args.owner || env.TAPD_DEFAULT_OWNER, status: args.status || "open", description: args.description };
    if (args["dry-run"]) return preview("create-story", payload);
    requireConfirm(args, "creating a Story/Chores container requires confirmation");
    const json = await postJson(accessToken, "/stories", payload);
    const created = json.data?.Story;
    const readback = await getJson(accessToken, "/stories", { workspace_id: workspaceId, id: created?.id, limit: 1 });
    const verified = (readback.data || []).map((row) => row.Story).find(Boolean);
    if (!verified || normalizeName(verified.name) !== normalizeName(args.name)) throw new Error(`write completed but readback verification failed; inspect story id ${created?.id || "unknown"}`);
    console.log(JSON.stringify({ status: "created_and_verified", story: verified }, null, 2));
    return;
  }

  if (command === "add-timesheet") {
    required({
      TAPD_WORKSPACE_ID: workspaceId,
      task_id: args["task-id"],
      spentdate: args.spentdate,
      timespent: args.timespent,
    }, ["TAPD_WORKSPACE_ID", "task_id", "spentdate", "timespent"]);
    const owner = args.owner || env.TAPD_DEFAULT_OWNER;
    if (!owner) throw new Error("missing --owner or TAPD_DEFAULT_OWNER");
    const originalHours = Number(args.timespent);
    const roundedHours = Math.round(originalHours * 2) / 2;
    if (roundedHours <= 0) throw new Error("rounded timespent must be at least 0.5 hours");
    const rounded = roundedHours !== originalHours;
    const sameDay = await timesheets(accessToken, workspaceId, { entity_type: "task", entity_id: args["task-id"], spentdate: args.spentdate, owner });
    if (sameDay.length) throw new Error(`existing same-task same-day timesheet found: ${JSON.stringify(sameDay)}; choose overwrite, add to existing, or keep it`);
    const ownerDay = await timesheets(accessToken, workspaceId, { spentdate: args.spentdate, owner });
    const existingDailyHours = ownerDay.reduce((sum, row) => sum + Number(row.timespent || 0), 0);
    const payload = {
      workspace_id: workspaceId,
      entity_type: "task",
      entity_id: args["task-id"],
      owner,
      timespent: roundedHours,
      spentdate: args.spentdate,
      memo: args.memo,
    };
    if (args["dry-run"]) return preview("add-timesheet", { ...payload, original_timespent: originalHours, existing_daily_hours: existingDailyHours, resulting_daily_hours: existingDailyHours + roundedHours });
    if (rounded) requireConfirm(args, `timespent ${originalHours} rounds to ${roundedHours} in 0.5-hour increments`);
    if (existingDailyHours + roundedHours > 8) requireConfirm(args, `daily total would be ${existingDailyHours + roundedHours}h, above the 8h reminder threshold`);
    const json = await postJson(accessToken, "/timesheets", payload);
    const created = json.data?.Timesheet;
    const readback = await timesheets(accessToken, workspaceId, { entity_type: "task", entity_id: args["task-id"], spentdate: args.spentdate, owner });
    const verified = readback.find((row) => String(row.id) === String(created?.id)) || (readback.length === 1 ? readback[0] : null);
    if (!verified || Number(verified.timespent) !== roundedHours) throw new Error(`write completed but readback verification failed; inspect timesheet id ${created?.id || "unknown"}`);
    const task = await syncTaskFromTimesheets(accessToken, workspaceId, args["task-id"], owner);
    console.log(JSON.stringify({ status: "created_and_verified", timesheet: verified, task_synced: task }, null, 2));
    return;
  }

  if (command === "delete-timesheets") {
    required({ TAPD_WORKSPACE_ID: workspaceId, entity_id: args["entity-id"], cost_ids: args["cost-ids"] }, ["TAPD_WORKSPACE_ID", "entity_id", "cost_ids"]);
    const costIds = String(args["cost-ids"]).split(",").map((v) => v.trim()).filter(Boolean);
    if (!costIds.length || costIds.length > 100) throw new Error("--cost-ids must contain 1-100 comma-separated timesheet IDs");
    const current = await timesheets(accessToken, workspaceId, { entity_type: args["entity-type"] || "task", entity_id: args["entity-id"] });
    const backup = current.filter((row) => costIds.includes(String(row.id)));
    if (backup.length !== costIds.length) throw new Error(`some timesheet IDs were not found; requested=${JSON.stringify(costIds)}, found=${JSON.stringify(backup.map((row) => row.id))}`);
    if (args["dry-run"]) return preview("delete-timesheets", { entity_id: args["entity-id"], cost_ids: costIds, backup });
    requireConfirm(args, `deleting timesheets requires confirmation; backup=${JSON.stringify(backup)}`);
    await postJson(accessToken, "/timesheets/delete_timesheets", {
      workspace_id: workspaceId, entity_type: args["entity-type"] || "task", entity_id: args["entity-id"], cost_ids: costIds,
    });
    const after = await timesheets(accessToken, workspaceId, { entity_type: args["entity-type"] || "task", entity_id: args["entity-id"] });
    const remaining = after.filter((row) => costIds.includes(String(row.id)));
    if (remaining.length) throw new Error(`delete returned success but readback still contains IDs: ${JSON.stringify(remaining.map((row) => row.id))}`);
    const task = (args["entity-type"] || "task") === "task"
      ? await syncTaskFromTimesheets(accessToken, workspaceId, args["entity-id"], args["current-user"] || env.TAPD_DEFAULT_OWNER)
      : undefined;
    console.log(JSON.stringify({ status: "deleted_and_verified", deleted_ids: costIds, backup, task_synced: task }, null, 2));
    return;
  }

  throw new Error(`unhandled command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
