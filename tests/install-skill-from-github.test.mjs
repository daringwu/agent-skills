import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("..", import.meta.url));
const installer = path.join(repo, "tools", "install-skill-from-github.mjs");

test("GitHub skill installer exposes standalone cross-platform help", async () => {
  const { stdout } = await exec(process.execPath, [installer, "--help"]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /--dest <skill-directory>/);
  assert.match(stdout, /sparse checkout/);
  assert.match(stdout, /feishu-doc-access/);
  assert.match(stdout, /tapd-openapi-workflow/);
});
