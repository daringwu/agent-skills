# 工时口径

量化部分见 `policy.json`（`dailyHoursCap`、`minTimesheetIncrement`、`effortEqualsCompleted`、`allowWeekendHours`、`timesheetGranularity`）。
这里只写需要判断、无法用一个数字表达的部分。

## effort 与实际工时是两件事

- `effort` = 估算工时，写在任务上。
- 实际工时 = timesheet 行的总和，通过 `POST /timesheets` 写入。
- `effort_completed` 是 TAPD 自己算的，不要直接写。

这是字段机制（见 `references/tapd-api-notes.md`）。口径问题是**要不要让两者相等** —— 见 `policy.json` 的 `effortEqualsCompleted`，目前未定义。

## 工时从哪来

写工时前必须先确定「这段时间做了什么」。归因口径是跨 skill 的，见 `policies/shared/work-attribution.md`。

在此之前不要凭任务名反推工时。**估出来的数字必须让用户确认过再写入 TAPD** —— 工时是会被用于考核的数据，写错的成本不对称。

## 跨天任务

一个任务跨多天时，按天拆成多条 timesheet，而不是在最后一天写一个总数。理由：日报/周报统计按 `spentdate` 聚合，写总数会让某一天异常高。

`due` 取最后一个有工时的日期（见 `policy.json` 的 `dueDateRule`）。

## 重排每日工时

用户要求「别让某天太满」时的处理顺序：

1. 按 `spentdate` 汇总当前实际工时
2. 找出超过 `dailyHoursCap` 的日期
3. **只移动导致超限的那些行**，不要整体重排——大范围改动会让 TAPD 的变更历史失去参考价值
4. 默认不移到周末（`allowWeekendHours`）
5. 移完重新读取并核对每日总计

`dailyHoursCap` 未定义时，先问用户上限是多少，不要假设 8 小时。

## 删改工时

TAPD 不支持直接改 timesheet 的日期。重排要先 `POST /timesheets/delete_timesheets` 再重建。

所以：**重排前先把原始 timesheet 数据存到 `outputs/`**，删除失败或重建失败时才有东西可回滚。
