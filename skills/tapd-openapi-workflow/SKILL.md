---
name: tapd-openapi-workflow
description: Connect to TAPD Open API and operate TAPD projects remotely. Use when Codex needs to read official TAPD API docs, configure TAPD app credentials, exchange access tokens, inspect workspaces/iterations/stories/tasks, create or update TAPD tasks/stories/Chores, write or rebalance TAPD timesheets, migrate task structures, verify daily hours, or debug TAPD Open API errors such as scope limited, Too Many Requests, missing workspace_id, owner fields, status, effort, effort_completed, priority, begin/due, story_id, or iteration_id.
---

# TAPD OpenAPI Workflow

## 门禁：每次使用本 skill 的第一步

1. 先运行 `node <本 skill 目录>/scripts/preflight.mjs`（如 `~/.codex/skills/tapd-openapi-workflow/scripts/preflight.mjs`
   或 `~/.claude/skills/tapd-openapi-workflow/scripts/preflight.mjs`）。**在它返回之前不要执行任何其他命令。**
2. 退出码：`0` = 全部能力就绪；`10` = 部分就绪；`20` = 全部阻塞；`2` = 清单/用法错误。
3. 退出码 `20`：**停下**。把输出整理成三段交给用户——AI 能直接做的 / 需要用户确认的 / 只能用户自己做的。
   不要尝试绕过，不要自行安装，不要改用浏览器、连接器或抓取等替代路径。
4. 退出码 `10`：只使用 READY 的能力，并明确告诉用户哪个能力不可用、缺什么。
   只关心某一个能力时用 `--capability <id>`，它会按该能力单独给出退出码。
5. 只安装 `requirements.json` 里 `tier: "auto"` 的项，方式是 `node <skill 目录>/scripts/setup.mjs`。
   它只执行清单里写死的命令。**绝不自己编 install 命令**；`tier: "assisted"` 有全局副作用，必须先向用户说明并取得同意（`--yes-assisted`）。
6. `tier: "manual"` 的项一律交给用户，不要代做，也不要猜测替代方案。
7. 凭据只写入 `~/.config/agent-skills/tapd-openapi-workflow/env`（chmod 600）。不要回显值、不要写进仓库、不要贴进对话。
8. 要给用户看完整前提说明（不做任何检查）：`node scripts/preflight.mjs --explain`。

9. 涉及「填什么值」的判断前，先读 `policies/policy.json`。**其中 `value` 为 `null` 的项表示口径尚未定义——
   必须先问用户，绝不自行假设、绝不沿用 note 里的示例值。** 判断类口径读 `policies/*.md`。

前提条件的唯一事实源是 `requirements.json`，量化口径的唯一事实源是 `policies/policy.json`。
本文档两者都不重复列举，以免不同步。

Use this skill for TAPD Open API work: connecting an app, reading the official docs, creating tasks, moving tasks between stories/Chores, writing actual hours with timesheets, and verifying iteration totals.

## Core Rules

- Treat TAPD credentials as secrets. Never print access tokens, `client_secret`, API passwords, or full auth headers.
- Prefer official TAPD docs before guessing endpoint names or field behavior. Read `references/tapd-api-notes.md` for known endpoints and doc URLs.
- Credentials live in the per-machine config file, never in the repo or the workspace:

```env
# ~/.config/agent-skills/tapd-openapi-workflow/env   (chmod 600)
TAPD_CLIENT_ID=tapd-app-...
TAPD_CLIENT_SECRET=...
TAPD_WORKSPACE_ID=53165807
TAPD_DEFAULT_OWNER=武佳宁wujianing02
```

  Pass it with `--env-file ~/.config/agent-skills/tapd-openapi-workflow/env`. Preflight reads the same file.

- Use project URLs to infer `workspace_id`; in `https://www.tapd.cn/tapd_fe/53165807/...`, the project ID is `53165807`.
- For current-user updates, pass `current_user` as the exact TAPD user field, often the full display/account string returned by `workspaces/users`, not just an English suffix.

## Workflow

1. **Authenticate**
   - Exchange `client_id/client_secret` with `grant_type=client_credentials`.
   - Do not expose the returned token.
   - If TAPD returns `scope limited`, the app is valid but lacks project/API authorization.

2. **Discover project context**
   - Verify `workspace_id` with `workspaces/get_workspace_info`.
   - Verify iteration with `iterations?workspace_id=...&id=...`.
   - Fetch story/task/chore IDs from TAPD rather than hardcoding when possible.
   - Fetch members with `workspaces/users` to confirm owner fields.

3. **Create/update work items**
   - Create tasks with `POST /tasks`.
   - Update tasks with the same `POST /tasks` endpoint plus `id`.
   - Soft-delete tasks with `POST /tasks` and `status=deleted`.
   - Create a Chores container as a story using `POST /stories` and the project's Chores `workitem_type_id`; find types with `GET /workitem_types`.

4. **Handle hours correctly**
   - Mechanism: `effort` is estimated effort; actual hours go through `POST /timesheets`;
     `effort_completed` is computed by TAPD and must not be written directly.
   - Mechanism: TAPD accepts only one timesheet row per task per day.
   - **每个字段填什么值由口径决定，不在这里定义。** 状态→字段对应表、`effort` 是否等于实际工时、
     最小记账粒度，全部读 `policies/policy.json`；判断部分读 `policies/hours.md`。

5. **Verify after every write**
   - Re-read tasks and timesheets from TAPD.
   - Check task count, total actual hours, status counts, missing due dates, priority values, and daily totals.
   - 重排每日工时的口径（上限、是否可排周末、只移超限行）见 `policies/hours.md` 与
     `policies/policy.json` 的 `dailyHoursCap` / `allowWeekendHours`。

## Reusable Script

Use `scripts/tapd_tool.mjs` for common operations. It reads env vars or `--env-file`.

Examples:

```bash
node <skill 目录>/scripts/tapd_tool.mjs token-check --env-file ~/.config/agent-skills/tapd-openapi-workflow/env
node <skill 目录>/scripts/tapd_tool.mjs workspace --env-file ~/.config/agent-skills/tapd-openapi-workflow/env
node <skill 目录>/scripts/tapd_tool.mjs iteration --env-file ~/.config/agent-skills/tapd-openapi-workflow/env --iteration-id 1153165807001014652
node <skill 目录>/scripts/tapd_tool.mjs daily-hours --env-file ~/.config/agent-skills/tapd-openapi-workflow/env --iteration-id 1153165807001014652 --prefix '<policy:taskNamePrefix.frontend>'
node <skill 目录>/scripts/tapd_tool.mjs create-task --env-file ~/.config/agent-skills/tapd-openapi-workflow/env --iteration-id 1153165807001014652 --story-id 1153165807001389831 --name '<policy:taskNamePrefix.frontend>示例任务' --status open
node <skill 目录>/scripts/tapd_tool.mjs add-timesheet --env-file ~/.config/agent-skills/tapd-openapi-workflow/env --task-id 1153165807001390153 --spentdate 2026-08-16 --timespent 2 --memo '报告展示收尾'
```

示例里的 `<policy:...>` 是占位符，实际值取 `policies/policy.json`，不要在本文档里写死。

Prefer the script for reads, daily-hour audits, and simple writes. For complex migrations, write a one-off script that follows the same patterns: idempotent reads, soft-delete rather than hard-delete, one TAPD row per task/date timesheet, and final verification.

## 两层结构

- **机制**（怎么调）：`references/tapd-api-notes.md` —— endpoint、字段语义、限制、报错。
- **口径**（填什么）：`policies/` —— `policy.json` 是量化口径的唯一事实源，
  `hours.md` / `fields-and-naming.md` 是需要判断的部分，
  `policies/shared/work-attribution.md` 是跨 skill 的工作归因口径。

不要在 SKILL.md 或 references 里重复口径值，会不同步。
