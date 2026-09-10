#!/usr/bin/env node

// Cross-platform sparse installer for one skill directory. Requires Node.js 20+ and Git.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function fail(message) {
  console.error(`install-skill-from-github: ${message}`);
  process.exit(2);
}

function printHelp() {
  console.log(`Install one SKILL.md-compatible skill from a GitHub repository path.

Usage:
  node install-skill-from-github.mjs --dest <skill-directory> [options]

Options:
  --repo <owner/repository>  GitHub repository (default: daringwu/agent-skills)
  --ref <branch-or-tag>      Git ref (default: main)
  --path <skill-path>        Path in repo (default: skills/gaotu/feishu-doc-access)
  --dest <skill-directory>   Final local skill directory (required)
  -h, --help                 Show this help

Examples:
  node install-skill-from-github.mjs --path skills/gaotu/feishu-doc-access --dest <agent-skills-dir>/feishu-doc-access
  node install-skill-from-github.mjs --path skills/gaotu/tapd-openapi-workflow --dest <agent-skills-dir>/tapd-openapi-workflow

Requires Node.js 20+ and Git. The installer uses sparse checkout and does not clone
the complete working tree. Existing installations are backed up under the shared
agent-skills configuration directory.`);
}

function args(argv) {
  const out = { repo: "daringwu/agent-skills", ref: "main", skillPath: "skills/gaotu/feishu-doc-access", dest: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--help" || key === "-h") {
      printHelp();
      process.exit(0);
    }
    const value = argv[++i];
    if (!value) fail(`missing value for ${key}`);
    if (key === "--repo") out.repo = value;
    else if (key === "--ref") out.ref = value;
    else if (key === "--path") out.skillPath = value;
    else if (key === "--dest") out.dest = value;
    else fail(`unknown option ${key}`);
  }
  if (!out.dest) fail("--dest is required (the final skill directory, not its parent)");
  if (!/^[-\w.]+\/[-\w.]+$/.test(out.repo)) fail("--repo must be owner/repository");
  if (!/^skills\/[\w.-]+\/[\w.-]+$/.test(out.skillPath)) fail("--path must be skills/<scope>/<skill-name>");
  return out;
}

function main() {
  const options = args(process.argv.slice(2));
  const destination = path.resolve(options.dest);
  if (destination === path.parse(destination).root) fail("refusing to install over a filesystem root");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skill-install-"));
  const checkout = path.join(temp, "repo");
  try {
    execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--branch", options.ref, `https://github.com/${options.repo}.git`, checkout], { stdio: "inherit" });
    execFileSync("git", ["sparse-checkout", "set", "--no-cone", `/${options.skillPath}/`], { cwd: checkout, stdio: "inherit" });
    execFileSync("git", ["checkout", options.ref], { cwd: checkout, stdio: "inherit" });
    const source = path.join(checkout, ...options.skillPath.split("/"));
    if (!fs.existsSync(path.join(source, "SKILL.md"))) fail(`remote path is not a skill: ${options.skillPath}`);
    const stage = `${destination}.new-${process.pid}`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, stage, { recursive: true, errorOnExist: true });
    let backup = null;
    if (fs.existsSync(destination)) {
      const configRoot = process.env.AGENT_SKILLS_HOME || path.join(os.homedir(), ".config", "agent-skills");
      const backupRoot = path.join(configRoot, "install-backups");
      fs.mkdirSync(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `${path.basename(destination)}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      fs.renameSync(destination, backup);
    }
    fs.renameSync(stage, destination);
    console.log(JSON.stringify({ status: "installed", source: `https://github.com/${options.repo}/tree/${options.ref}/${options.skillPath}`, destination, backup }, null, 2));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
