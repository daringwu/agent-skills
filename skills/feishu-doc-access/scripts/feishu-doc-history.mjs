#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error(`Usage:
  node feishu-doc-history.mjs --doc <url-or-token> --out <output-prefix> [--profile <profile>] [--as user|bot] [--page-size 20] [--timezone-offset +08:00]

Examples:
  node feishu-doc-history.mjs --doc 'https://gaotuedu.feishu.cn/wiki/xxx' --profile codex-feishu-history --out outputs/doc-history
  node feishu-doc-history.mjs --doc docxToken --out work/history --timezone-offset +08:00
`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
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
    as: args.as ?? "user",
    pageSize: String(args["page-size"] ?? "20"),
    timezoneOffset: args["timezone-offset"] ?? "+08:00",
  };
}

function offsetMs(offset) {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) throw new Error(`Invalid timezone offset: ${offset}`);
  const sign = match[1] === "+" ? 1 : -1;
  return sign * ((Number(match[2]) * 60 + Number(match[3])) * 60 * 1000);
}

function runHistoryPage({ doc, profile, as, pageSize, pageToken }) {
  const args = ["-y", "@larksuite/cli@latest"];
  if (profile) args.push("--profile", profile);
  args.push("docs", "+history-list", "--as", as, "--doc", doc, "--page-size", pageSize, "--format", "json");
  if (pageToken) args.push("--page-token", pageToken);
  const text = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(text);
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

function summarize(entries, tzOffset) {
  const byDay = new Map();
  const addMs = offsetMs(tzOffset);
  for (const entry of entries) {
    const local = new Date(new Date(entry.edit_time).getTime() + addMs);
    const day = local.toISOString().slice(0, 10);
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
    row.firstMs = Math.min(row.firstMs, local.getTime());
    row.lastMs = Math.max(row.lastMs, local.getTime());
  }
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
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
      timezone_offset: tzOffset,
    }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = [];
  let pageToken = "";
  let page = 0;
  while (true) {
    const json = runHistoryPage({ ...options, pageToken });
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
  const summary = summarize(uniqueEntries, options.timezoneOffset);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(`${options.out}-all.json`, JSON.stringify({ ok: true, doc: options.doc, entries: uniqueEntries }, null, 2));
  fs.writeFileSync(`${options.out}-daily-summary.json`, JSON.stringify({ ok: true, doc: options.doc, total: uniqueEntries.length, summary }, null, 2));
  console.log(JSON.stringify({ total: uniqueEntries.length, all: `${options.out}-all.json`, daily: `${options.out}-daily-summary.json` }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
