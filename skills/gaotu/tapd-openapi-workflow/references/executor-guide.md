# TAPD 闭环执行器

## 单项命令

`tapd_tool.mjs` 支持查询：`token-check`、`workspace`、`iteration`、`users`、`validate-owner`、
`workitem-types`、`list-tasks`、`get-task`、`list-stories`、`list-timesheets`、`daily-hours`；
支持写入：`create-task`、`update-task`、`create-story`、`add-timesheet`、`delete-timesheets`。

所有写命令支持 `--dry-run`。保护操作使用 `--confirm`。脚本会执行参数校验、分页查询、规范化同名检查、
工时冲突检查和写后回读。`delete-timesheets --cost-ids 1,2` 的预览与结果会包含可恢复的原始记录备份。

## 批量 plan

```json
{
  "operations": [
    {
      "operation": "create-task",
      "iterationId": "123",
      "storyId": "456",
      "name": "用户明确提供的前缀 + 任务名",
      "owner": "workspaces/users 返回的完整 user",
      "status": "open",
      "description": "交付物与范围"
    },
    {
      "operation": "add-timesheet",
      "taskId": "789",
      "spentdate": "2026-09-10",
      "timespent": 2.5,
      "memo": "当天实际完成的工作"
    }
  ]
}
```

字段名使用 camelCase；支持 `taskId`、`storyId`、`iterationId`、`workitemTypeId`、`currentUser`、
`priorityLabel`、`entityId`、`entityType`、`costIds`，其他简单字段如 `name/status/owner/begin/due/effort/memo`
保持原名。`costIds` 可为数组。

执行顺序：输出按任务分组的完整预览 → 对全部操作做只读预检 → 用户确认 → 顺序写入 → 每项回读验证。
任何一步失败立即停止，保留已发生的写入并明确报告，不自动回滚或不确定重试。

