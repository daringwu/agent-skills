# 命名与字段留空口径

量化部分见 `policy.json`（`taskNamePrefix`、`writePriority`、`statusFields`）。

## 为什么默认留空而不是默认填

TAPD 里一个被填错的字段比空字段更糟：空字段一眼能看出「还没定」，填错的字段会被下游统计当成事实。

所以默认口径是**能不填就不填**：

- `priority` / `priority_label`：不填。团队不靠 TAPD 优先级排期，填了反而制造假信号。
- `open` 状态任务的 `begin` / `due`：不填，除非用户给了明确排期。
- `progressing` 的 `due`：不填——进行中的任务给一个猜的完成日，会让迭代看板显示虚假的逾期。
- `effort`：见 `policy.json` 的 `effortEqualsCompleted`，未定义时先问。

## owner 字段

必须用 `GET /workspaces/users` 返回的 `UserWorkspace.user` 精确值，不能用英文后缀或显示名。这是机制约束，不是口径 —— 详见 `references/tapd-api-notes.md`。

口径部分：**不要替别人填 owner**。批量建任务时如果 owner 不明确，宁可留给用户确认，也不要默认填成当前账号。

## 任务名

- 前端任务用 `policy.json` 的 `taskNamePrefix.frontend` 前缀，统计脚本依赖它做过滤。
- 任务名描述**产出**而不是活动：写「<某页面>接入埋点」而不是「开发埋点」。理由：验收时能直接对照，也便于事后从任务名反查代码变更。
## 任务粒度（待定义）

活动清单上的多行怎么合并成一个 TAPD 任务行，见 `policy.json` 的 `taskGranularity`。候选口径：

- **按可验收产出** —— 一个功能/页面/接口 = 一个任务，可能含多个 PR
- **按 PR** —— 归因最客观，但任务碎，且同一天多个 PR 会占多条 timesheet（TAPD 每任务每天只允许一条）
- **跟随 TAPD 需求** —— story 怎么拆就怎么建，和产品测试对得上

还有两个子口径待定，见 `policy.json`：

- `reworkAttribution` —— 调研 / 返工 / 修自己引入的 bug，算独立任务还是并进原任务
- `nonCodeWork` —— 评审、联调、答疑、值班这类无代码产出的工作，走 Chores 还是也建技术任务

粒度是**记录格式**问题，不是归因问题。上游的活动清单不决定粒度——同一份清单在不同粒度口径下会合并成不同的任务行。

## Chores（非技术类工作）

TAPD 里 Chores 可能被配成 story 类型的工作项。会议、评审、答疑这类没有代码产出的工作放这里，不要混进技术任务，否则「技术任务总工时」这个口径就失真了。

具体的 `workitem_type_id` 要现查（机制，见 references），不要硬编码。
