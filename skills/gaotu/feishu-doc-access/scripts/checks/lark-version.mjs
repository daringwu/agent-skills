#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const pkg = process.env.LARK_CLI_PKG || "@larksuite/cli@1.0.90";
try {
  const output = execFileSync("npx", ["-y", pkg, "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  process.stdout.write(output);
} catch (error) {
  process.stdout.write(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  process.exit(typeof error.status === "number" ? error.status : 1);
}
