# 官方能力路由

本 Skill 是文档中心编排与安全层，不复制官方 `lark-cli` 的完整命令说明。执行前运行对应域的 `--help`；需要原生 API 时先运行 `lark-cli schema <resource.method>`，不得猜参数。

所有命令显式使用 `--as user`。以下能力均为可选能力，只有命中当前任务时才读取对应官方帮助并加载所需上下文。

## Docs：正文与资源

- `docs +fetch`：全文、目录、章节、block 范围或关键词读取。
- `docs +create`：从 XML 或 Markdown 创建文档。
- `docs +update`：`str_replace`、`append`、`block_insert_after`、`block_replace`、`block_copy_insert_after`、`block_move_after`、`block_delete`、`overwrite`。
- `docs +history-list`、`+history-revert`、`+history-revert-status`：历史查询和回滚。
- `docs +media-insert`、`+media-download`、`+media-preview`：图片和附件。
- `docs +resource-download`、`+resource-update`、`+resource-delete`：Docx 封面。
- 画板与思维笔记按官方 `whiteboard` / `mindnotes` 帮助路由。

## Wiki：空间、节点与成员

- 空间：`+space-list`、`+space-create`、`+delete-space`。
- 节点：`+node-get`、`+node-list`、`+node-create`、`+node-copy`、`+move`、`+move-to-drive`、`+node-delete`。
- 成员：`+member-list`、`+member-add`、`+member-remove`。
- Wiki URL 先解析真实 `space_id`、`node_token`、`obj_token` 和 `obj_type`；不得把名称或 URL 当作 ID。

## Drive：文件与治理

- 发现：`+inspect`、`+search`、文件列表、元数据、统计、访问记录和容量。
- 内容流转：`+upload`、`+download`、`+preview`、`+cover`、`+export`、`+import`。
- 组织：`+create-folder`、`+copy`、`+move`、`+update-title`、`+delete`、`+create-shortcut`。
- 同步：`+status`、`+pull`、`+push`、`+sync`。
- 评论：添加、查询、回复、更新/删除回复、解决/恢复、reaction。
- 权限：访问申请、协作者列表/添加/移除、公开权限、owner 转移、密级标签。
- 版本：`+version-history`、`+version-get`、`+version-revert`、`+version-delete`。
- 事件：订阅、取消订阅、查询订阅状态。

## 编排边界

核心高频路径使用本 Skill 脚本：

- `scripts/feishu-doc.mjs fetch|inspect|update`
- `scripts/feishu-doc-history.mjs`

其他能力直接调用官方 CLI，但仍必须遵循 `policies/write-safety.md`。删除、覆盖、回滚、权限/owner 变更、移动和任何批量操作不能因为官方命令存在就绕过本 Skill 的预览与确认规则。
