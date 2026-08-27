#!/usr/bin/env node
// Preflight check helper for lark-cli. Read-only: it never logs in, never mutates
// profiles, and never prints appSecret or tokens.
//
// Usage: node lark-status.mjs --mode profile|user
// exit 0 = pass, exit 1 = fail. First stdout line becomes the preflight note.

import { execSync } from "node:child_process";

const PKG = process.env.LARK_CLI_PKG || "@larksuite/cli@latest";
const PROFILE = process.env.LARK_PROFILE || "";
const mode = (() => {
  const i = process.argv.indexOf("--mode");
  return i >= 0 ? process.argv[i + 1] : "profile";
})();

function fail(msg) {
  console.log(msg);
  process.exit(1);
}

if (!PROFILE) fail("LARK_PROFILE 未设置，无法确定要检查哪个 lark-cli profile");

let raw;
try {
  raw = execSync(`npx -y ${PKG} --profile "${PROFILE}" auth status`, {
    encoding: "utf8",
    timeout: 90000,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  if (e.killed) fail("lark-cli auth status 超时（网络或 npx 下载慢）");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  if (parsed?.error?.subtype === "not_configured") {
    fail(`profile "${PROFILE}" 不存在（lark-cli 里未配置）`);
  }
  fail(`lark-cli auth status 失败：${(parsed?.error?.message ?? text.trim().split("\n")[0] ?? "unknown").slice(0, 160)}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  fail("无法解析 lark-cli auth status 的输出");
}

if (mode === "profile") {
  console.log(`profile "${PROFILE}" 已配置（brand=${data.brand ?? "?"}）`);
  process.exit(0);
}

const user = data.identities?.user;
if (!user) fail(`profile "${PROFILE}" 没有 user 身份，需要用户 OAuth 登录`);
if (user.available !== true) {
  fail(`user 身份不可用（status=${user.status ?? "unknown"}），refresh token 可能已过期，需要重新登录`);
}
// needs_refresh with available:true is fine — the CLI auto-refreshes on next call.
const who = user.userName ? ` as ${user.userName}` : "";
console.log(`user 身份可用（status=${user.status}）${who}`);
process.exit(0);
