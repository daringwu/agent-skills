#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args["plan-file"]) throw new Error("missing --plan-file <json>");
const plan = JSON.parse(fs.readFileSync(args["plan-file"], "utf8"));
if (!Array.isArray(plan.operations) || !plan.operations.length) throw new Error("plan.operations must be a non-empty array");
const supported = new Set(["create-task", "update-task", "create-story", "add-timesheet", "delete-timesheets"]);
for (const [index, op] of plan.operations.entries()) {
  if (!supported.has(op.operation)) throw new Error(`operations[${index}].operation is unsupported`);
}
const plannedNames = new Set();
for (const op of plan.operations.filter((item) => item.operation === "create-task")) {
  const normalized = String(op.name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const key = `${op.iterationId || ""}\0${normalized}`;
  if (plannedNames.has(key)) throw new Error(`plan contains duplicate normalized task name in one iteration: ${op.name}`);
  plannedNames.add(key);
}

const dates = new Set(plan.operations.map((op) => op.spentdate).filter(Boolean));
const isBatch = plan.operations.length > 1 || dates.size > 1;
const destructive = plan.operations.some((op) => op.operation === "delete-timesheets" || (op.operation === "update-task" && op.status === "deleted"));
const preview = {
  batch: isBatch,
  requires_confirmation: isBatch || destructive,
  groups: Object.values(plan.operations.reduce((groups, op, index) => {
    const key = op.taskId || op.name || op.entityId || `story-${index + 1}`;
    groups[key] ||= { task: key, operations: [] };
    groups[key].operations.push({
      operation: op.operation, taskName: op.name, story: op.storyId, status: op.status,
      owner: op.owner, dates: { begin: op.begin, due: op.due }, effort: op.effort,
      dailyTimesheets: op.spentdate ? [{ date: op.spentdate, hours: op.timespent }] : undefined,
      memo: op.memo,
    });
    return groups;
  }, {})),
};
console.log(JSON.stringify(preview, null, 2));
if ((isBatch || destructive) && !args.confirm) throw new Error("full plan requires confirmation; review preview and rerun with --confirm");

const tool = fileURLToPath(new URL("./tapd_tool.mjs", import.meta.url));
const common = [];
const defaultEnv = `${process.env.HOME}/.config/agent-skills/tapd-openapi-workflow/env`;
if (args["env-file"] || fs.existsSync(defaultEnv)) common.push("--env-file", args["env-file"] || defaultEnv);
if (args["workspace-id"]) common.push("--workspace-id", String(args["workspace-id"]));

function operationArgs(op, dryRun) {
  const mapped = {
    taskId: "task-id", storyId: "story-id", iterationId: "iteration-id", workitemTypeId: "workitem-type-id",
    currentUser: "current-user", priorityLabel: "priority-label", entityId: "entity-id", entityType: "entity-type", costIds: "cost-ids",
  };
  const cli = [op.operation, ...common];
  for (const [key, value] of Object.entries(op)) {
    if (key === "operation" || value === undefined || value === null) continue;
    const flag = mapped[key] || key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    cli.push(`--${flag}`, Array.isArray(value) ? value.join(",") : String(value));
  }
  if (dryRun) cli.push("--dry-run");
  else if (args.confirm) cli.push("--confirm");
  return cli;
}

// Preflight every operation before the first mutation. This catches missing context,
// normalized duplicates, existing timesheets, invalid IDs, and protected transitions.
for (const op of plan.operations) {
  const check = spawnSync(process.execPath, [tool, ...operationArgs(op, true)], { encoding: "utf8", env: process.env });
  if (check.status !== 0) throw new Error(`plan preflight failed for ${op.operation}: ${check.stderr.trim() || check.stdout.trim()}`);
}
if (args["dry-run"]) process.exit(0);

const results = [];
for (const op of plan.operations) {
  const run = spawnSync(process.execPath, [tool, ...operationArgs(op, false)], { encoding: "utf8", env: process.env });
  if (run.status !== 0) throw new Error(`execution stopped at ${op.operation}; previous writes are preserved: ${run.stderr.trim() || run.stdout.trim()}`);
  results.push(JSON.parse(run.stdout));
}
console.log(JSON.stringify({ status: "plan_applied_and_verified", count: results.length, results }, null, 2));
