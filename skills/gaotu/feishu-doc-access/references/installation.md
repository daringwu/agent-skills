# 跨平台安装与更新

Skill 不依赖 Codex 专属工具。运行时只要求 Node.js 20+、Git 和官方 `lark-cli`，可用于任何能够加载 `SKILL.md` 的 Agent。

## 从 GitHub 具体路径安装

先从仓库下载通用安装器 `tools/install-skill-from-github.mjs`，再执行：

```text
node install-skill-from-github.mjs --repo daringwu/agent-skills --ref main --path skills/gaotu/feishu-doc-access --dest <Agent的skills目录>/feishu-doc-access
```

安装器使用 Git sparse checkout，只取目标 Skill 路径，不要求用户手工克隆完整仓库。目标已存在时先移动到用户配置目录的 `agent-skills/install-backups/`，再原子替换；备份不会被 Agent 重复发现，机器配置目录不会被覆盖。

安装器地址：

```text
https://raw.githubusercontent.com/daringwu/agent-skills/main/tools/install-skill-from-github.mjs
```

macOS/Linux 可用 `curl` 下载；Windows PowerShell 可用 `Invoke-WebRequest -OutFile` 下载。下载后使用相同的 `node` 命令，参数不因平台变化。

可先查看完整参数，不需要提供安装目标：

```text
node install-skill-from-github.mjs --help
```

## 首次验证

```text
node <安装目录>/scripts/check-update.mjs
node <安装目录>/scripts/preflight.mjs --explain
node <安装目录>/scripts/preflight.mjs
node --test <安装目录>/tests/*.test.mjs
```

Windows PowerShell 不展开 `*.test.mjs` 时，直接传测试文件：

```text
node --test <安装目录>/tests/feishu-doc.test.mjs
```

凭据和状态始终留在用户配置目录，不随安装更新：

- macOS/Linux：`~/.config/agent-skills/feishu-doc-access/`
- Windows：`%USERPROFILE%\.config\agent-skills\feishu-doc-access\`

也可用 `AGENT_SKILLS_HOME` 指定通用配置根目录。
