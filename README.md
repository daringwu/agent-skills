# agent-skills

跨工具复用的自用 Agent Skills。同一份 skill 在 Codex、Claude Code 或任何读 `SKILL.md` 的工具里都能装、都能跑。

设计目标：**在一台新机器上装完之后，第一次使用不会盲目执行，而是先给出一份"AI 能装什么 / 你要提供什么 / 流程是什么"的引导。**

规则细节见 [CONVENTIONS.md](./CONVENTIONS.md)。

## 目录

```
skills/
├── feishu-doc-access/        飞书 Wiki/Docx 内容、元数据、编辑历史
└── tapd-openapi-workflow/    TAPD 需求/任务/工时读写
tools/
├── templates/                preflight.mjs / setup.mjs 的母版
└── sync-core.sh              把母版同步进每个 skill
install.sh                    装到各工具的 skills 目录
```

## 安装

```bash
git clone <this-repo> ~/Documents/project/agent-skills
cd ~/Documents/project/agent-skills

./install.sh                  # 软链到已存在的 ~/.codex/skills 和 ~/.claude/skills
./install.sh --codex          # 只装 Codex
./install.sh --claude         # 只装 Claude Code
./install.sh --dir <path>     # 其他工具
./install.sh --copy           # 拷贝而非软链
```

默认用**软链**：`git pull` 之后所有工具同步生效，不用重装。已存在的同名目录会先备份成 `<name>.bak.<pid>`。

Codex 也可以用它自带的 installer 从 GitHub 直接装（支持私有仓库）：

```bash
~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo <owner>/agent-skills \
  --path skills/feishu-doc-access skills/tapd-openapi-workflow
```

## 装完之后：先跑 preflight

安装**不等于可用**。凭据、登录态、外部权限都不在仓库里。

```bash
node ~/.codex/skills/feishu-doc-access/scripts/preflight.mjs
```

退出码：

| 码 | 含义 | 该做什么 |
|---|---|---|
| `0` | 全部能力就绪 | 直接用 |
| `10` | 部分能力就绪 | 用可用的能力，其余按引导补 |
| `20` | 全部阻塞 | 按引导补齐，别绕过 |

输出会分成三段：AI 能直接装的 / 需要你确认的 / 只能你自己做的（含控制台链接和审批预期时长）。

常用参数：

```bash
node scripts/preflight.mjs --explain              # 只看完整前提说明，不做检查
node scripts/preflight.mjs --capability read      # 只判断某一个能力
node scripts/preflight.mjs --json                 # 机器可读
node scripts/preflight.mjs --no-cache             # 忽略缓存全量重查
node scripts/setup.mjs                            # 只装 tier=auto 的项
node scripts/setup.mjs --yes-assisted             # 同意执行有全局副作用的安装
```

## 凭据放哪

**不在这个仓库里。** 每台机器一份：

```
~/.config/agent-skills/<skill-name>/
├── env          # chmod 600
└── state.json   # 检查结果缓存
```

同一台机器上所有工具共用这份配置——配一次，Codex 和 Claude Code 都能用。preflight 只检查变量**是否存在**，从不打印值。

`AGENT_SKILLS_HOME` 可以覆盖配置根目录（想模拟一台干净机器时很有用）。

## 改了 preflight/setup 之后

母版在 `tools/templates/`，skill 里的是同步副本：

```bash
./tools/sync-core.sh
```

原因见 CONVENTIONS.md 的"已知取舍"——每个 skill 必须能被单独安装，所以不能共享 `lib/`。

## 这个仓库应该是私有的

不含任何 secret（凭据全部走机器级配置文件），但含内部标识：TAPD 项目 ID、账号字段、内部飞书域名。不要公开。
