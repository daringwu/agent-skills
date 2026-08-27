# TAPD API Notes

Use these notes as a quick map. If anything is uncertain or current behavior matters, browse the official docs first.

## Official Docs To Check

- Task create: `https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/add_task.html`
- Task update: `https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/update_task.html`
- Timesheet create: `https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/timesheet/add_timesheet.html`
- Project authorization via `client_credentials`: `https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/%E6%8E%88%E6%9D%83%E5%87%AD%E8%AF%81/%E9%A1%B9%E7%9B%AE%E6%80%81.html`
- API usage overview: `https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/%E4%BD%BF%E7%94%A8%E5%BF%85%E8%AF%BB.html`

## Authentication

- Exchange app credentials with `POST https://api.tapd.cn/tokens/request_token`.
- Use Basic auth where username is `TAPD_CLIENT_ID` and password is `TAPD_CLIENT_SECRET`.
- Body: `grant_type=client_credentials`.
- Success returns `status: 1`, `data.access_token`, and `expires_in`.
- Use `Authorization: Bearer <token>` for later API calls.
- Do not log access tokens.

## Useful Endpoints

- Workspace info: `GET /workspaces/get_workspace_info?workspace_id=...`
- Project users: `GET /workspaces/users?workspace_id=...`
- Iterations: `GET /iterations?workspace_id=...&id=...`
- Stories: `GET /stories?...`, `POST /stories`
- Tasks: `GET /tasks?...`, `POST /tasks`
- Work item types: `GET /workitem_types?workspace_id=...`
- Timesheets: `GET /timesheets?...`, `POST /timesheets`
- Delete timesheets: `POST /timesheets/delete_timesheets`

## Tasks

- Create a task with `POST /tasks`, including `workspace_id`, `name`, and optional `iteration_id`, `story_id`, `owner`, `begin`, `due`, `effort`, `description`.
- Update a task with `POST /tasks`, including `workspace_id`, `id`, fields to change, and often `current_user`.
- Soft-delete a task with `POST /tasks` and `status=deleted`.
- Common statuses:
  - `open`: 未开始
  - `progressing`: 进行中
  - `done`: 已完成
  - `deleted`: soft-deleted

## Chores

- TAPD Chores may be configured as a story work item type.
- Discover the project type ID with `GET /workitem_types?workspace_id=...`.
- Example seen in one project:
  - Chinese name: `非技术类工作`
  - English name: `Chores`
  - `entity_type: story`
- Create a Chores container with `POST /stories` using `workspace_id`, `name`, `parent_id`, `workitem_type_id`, and `iteration_id`.

## Hours And Timesheets

- `effort` is estimated effort.
- `effort_completed` is completed/actual effort as TAPD calculates from task fields and timesheets.
- For actual work logs, use `POST /timesheets` with `workspace_id`, `entity_type=task`, `entity_id=<task_id>`, `owner`, `timespent`, `spentdate`, and `memo`.
- TAPD may reject duplicate same-task same-day timesheets with an error like `timesheet has existed in ...`. Aggregate multiple same-day details into one timesheet memo for that task.
- For multi-day work, write one timesheet row per date rather than one total row.
- To rebalance daily hours, delete and recreate affected timesheet rows, then re-read totals.

## 团队口径不在这里

本文件只记录 TAPD 的**机制**：endpoint、字段语义、限制、报错。

团队/个人**口径**（任务名前缀、哪些字段留空、工时上限、状态字段填法）已移到 `policies/`：
- `policies/policy.json` —— 量化口径，唯一事实源
- `policies/hours.md` —— 工时口径
- `policies/fields-and-naming.md` —— 命名与字段留空口径

机制变化来自 TAPD 改 API；口径变化来自团队改约定。两者独立演进，所以分开放。

## Error Hints

- `scope limited`: credentials work, but app lacks permission or project authorization. Ask the user/admin to configure API scopes and authorize the workspace.
- `Too Many Requests`: TAPD rate-limited the token or endpoint. Add exponential backoff and rerun idempotently.
- Empty data for a known ID: verify `workspace_id`, soft-deleted status, permission scope, and whether the item is under another entity type.
- Owner mismatch: fetch `workspaces/users`; use the exact `UserWorkspace.user` value.
