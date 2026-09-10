# 跨平台安装与更新

本 Skill 不依赖 Codex、Claude Code 或其他特定 Agent 的工具。运行时只需要 Node.js 20+；从 GitHub 子目录安装时还需要 Git。

下载仓库中的通用安装器：

```text
https://raw.githubusercontent.com/daringwu/agent-skills/main/tools/install-skill-from-github.mjs
```

然后在 macOS、Linux 或 Windows 上运行同一条 Node 命令：

```text
node install-skill-from-github.mjs --repo daringwu/agent-skills --ref main --path skills/gaotu/tapd-openapi-workflow --dest <Agent的skills目录>/tapd-openapi-workflow
```

安装器使用 Git sparse checkout，只获取目标 Skill 路径。已有目标会改名为带时间戳的备份；用户配置目录不会被覆盖。

配置位置：

- macOS/Linux：`~/.config/agent-skills/tapd-openapi-workflow/env`
- Windows：`%USERPROFILE%\.config\agent-skills\tapd-openapi-workflow\env`
- 自定义：设置 `AGENT_SKILLS_HOME`。

验证：

```text
node <安装目录>/scripts/check-update.mjs
node <安装目录>/scripts/preflight.mjs --explain
node <安装目录>/scripts/preflight.mjs --capability read
node --test <安装目录>/tests/tapd_tool.test.mjs
```
