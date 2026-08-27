# agent-skills

跨工具复用的自用 Agent Skills。同一份 skill 在 Codex、Claude Code 或任何读 `SKILL.md` 的工具里都能装、都能跑。

设计目标：**在一台新机器上装完之后，第一次使用不会盲目执行，而是先给出一份"AI 能装什么 / 你要提供什么 / 流程是什么"的引导。**

规则细节见 [CONVENTIONS.md](./CONVENTIONS.md)。

## 目录

```
skills/
├── gaotu/                    依赖公司内部系统与鉴权，换环境跑不通
│   ├── feishu-doc-access/    飞书 Wiki/Docx 内容、元数据、编辑历史
│   │   ├── SKILL.md          门禁 + 流程
│   │   ├── requirements.json 前提条件（能不能用）
│   │   ├── policies/         口径（填什么值）
│   │   └── references/       机制（怎么调）
│   └── tapd-openapi-workflow/  TAPD 需求/任务/工时读写
└── personal/                 通用 skill，不依赖任何公司内部系统
policies/shared/              跨 skill 口径母版（工作归因）
tools/
├── templates/                preflight.mjs / setup.mjs 的母版
├── sync-core.sh              把母版与共享口径同步进每个 skill
└── policy-todo.sh            列出所有尚未定义的口径
install.sh                    装到各工具的 skills 目录
```

## 三层内容

| 层 | 位置 | 变化来源 |
|---|---|---|
| 门禁 | `SKILL.md` 第一节 | 本仓库约定 |
| 机制 | `references/*.md` | 外部系统改 API |
| 口径 | `policies/` | 你和团队改约定 |

口径分量化（`policies/policy.json`，可被脚本读取）和判断类（`policies/*.md`）。
`policy.json` 里 `value: null` 表示**尚未定义，必须先问用户**，不是"用默认值"。

```bash
./tools/policy-todo.sh    # 看还有哪些口径没定义
```

## 安装

```bash
git clone <this-repo> ~/Documents/project/agent-skills
cd ~/Documents/project/agent-skills

./install.sh                     # 软链所有 skill 到已存在的 ~/.codex/skills 和 ~/.claude/skills
./install.sh --scope personal    # 只装通用 skill（个人机器用这个）
./install.sh --scope gaotu       # 只装依赖公司内部系统的
./install.sh --codex             # 只装 Codex
./install.sh --claude            # 只装 Claude Code
./install.sh --dir <path>        # 其他工具
./install.sh --copy              # 拷贝而非软链
./install.sh --only <skill-name> # 只装某一个
```

默认用**软链**：`git pull` 之后所有工具同步生效，不用重装。已存在的同名目录会先备份成 `<name>.bak.<pid>`。

**仓库里按 scope 分目录，安装后是平铺的**（`<target>/<name>`）—— 各工具直接读 skills 目录下一层，不认嵌套。所以跨 scope 不能有同名 skill，`install.sh` 会检查并拒绝。

## 两个 scope

| scope | 判断标准 | 装在哪 |
|---|---|---|
| `gaotu/` | 依赖内部 API、内网域名、需企业审批的凭据 | 公司机器 |
| `personal/` | 换一家公司还能用 | 所有机器 |

`gaotu/` 的 skill 在别的环境装了也跑不通（preflight 直接 BLOCKED），所以个人机器上用 `--scope personal`。

Codex 也可以用它自带的 installer 从 GitHub 直接装（支持私有仓库）：

```bash
~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo <owner>/agent-skills \
  --path skills/gaotu/feishu-doc-access skills/gaotu/tapd-openapi-workflow
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

母版在 `tools/templates/`（脚本）和 `policies/shared/`（跨 skill 口径），skill 里的是同步副本：

```bash
./tools/sync-core.sh
```

原因见 CONVENTIONS.md 的"已知取舍"——每个 skill 必须能被单独安装，所以不能共享 `lib/`。

## 这个仓库应该是私有的

不含任何 secret（凭据全部走机器级配置文件），但含内部标识：TAPD 项目 ID、账号字段、内部飞书域名。不要公开。
