# Skill 约定

所有 skill 遵循同一套结构，目标是：**在一台新机器上安装后不会盲目执行，而是先给出一份"谁该做什么"的引导**。

## 三条核心原则

1. **声明式，不是叙述式。** 前提条件写在 `requirements.json` 里，不写在 SKILL.md 的散文里。散文只有模型会读，读了还可能跳过；清单文件能被脚本校验，产出稳定结论。
2. **检查和安装彻底分离。** `preflight.mjs` 只检查、只报告、永不改动系统；`setup.mjs` 只做被授权的安装。
3. **门禁写在代码里，不只写在提示里。** SKILL.md 第一节是硬规则，同时业务脚本自己也应在入口处校验。散文是软约束，脚本拒绝执行是硬约束。

## 依赖的三级分类

| tier | 定义 | 判据 | 例子 |
|---|---|---|---|
| `auto` | AI 可直接执行，无需请示 | 幂等、局部、不涉密、失败可回滚 | `npx -y pkg@x.y`、建目录 |
| `assisted` | AI 能执行，但必须先说明并取得同意 | 有全局副作用或不可逆 | `npm i -g`、`brew install`、改 shell profile |
| `manual` | 只有用户能完成，AI 连尝试都不该尝试 | 需要人的身份、审批或线下动作 | API key、浏览器 OAuth、内网权限、管理员审批 |

规则：

- `auto` 的 install 命令**必须由作者预先写死在清单里**。模型绝不现场编造 install 命令——那是污染机器最常见的路径。
- **优先把依赖设计成"不需要安装"**：能 `npx -y pkg@ver` 就别全局装。这一条能把 `auto`/`assisted` 砍掉一大半。
- 同一能力有多条授权路径时，用 `minimalPermission: true` 标出权限最小的那条，避免默认引导用户去开最大权限。

## 按能力分组，而不是一刀切

前提条件挂在**能力（capability）**上，不是挂在整个 skill 上。这样结论不是"能用/不能用"，而是哪些能力可用：

- 全部能力就绪 → `exit 0` READY
- 部分能力就绪 → `exit 10` DEGRADED
- 没有能力就绪 → `exit 20` BLOCKED

好处很实际：只想做只读操作时，不该被"写操作缺 secret"拦住。

## 目录结构

skill 内（进 git，无密）：

```
skills/<name>/
├── SKILL.md                    # 第一节是门禁规则
├── requirements.json           # 唯一事实源，零依赖可解析
├── scripts/
│   ├── preflight.mjs           # 由 tools/sync-core.sh 同步，勿直接改
│   ├── setup.mjs               # 同上
│   ├── checks/*.mjs            # 复杂检查放脚本，不塞进 JSON 字符串
│   └── <业务脚本>
└── references/*.md
```

机器内（不进 git，跨工具共享）：

```
~/.config/agent-skills/<name>/
├── env          # chmod 600，凭据只在这里
└── state.json   # 检查结果缓存 + requirements 哈希
```

用 JSON 而不是 YAML：YAML 要引解析器，而这一层恰恰最不该有依赖。
可用 `AGENT_SKILLS_HOME` 覆盖配置根目录。

这个位置有三个好处：① 重新 clone 仓库不丢凭据；② `git pull` 不可能泄密；③ **同一台机器上所有工具共用一份配置**——配一次，Codex 和 Claude Code 都能用。

## requirements.json 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 决定配置目录 `~/.config/agent-skills/<name>/` |
| `capabilities.<id>.requires` | ✅ | 该能力依赖的 requirement id 列表 |
| `requirements.<id>.tier` | ✅ | `auto` / `assisted` / `manual` |
| `requirements.<id>.kind` | | `binary` `command` `npx` `env` `file`，默认 `command` |
| `check` | ✅ | 命令字符串；`kind: env` 时是变量名数组；`kind: file` 时是路径 |
| `install` | | 仅 `auto`/`assisted`。**必须写死，含版本号** |
| `guide` | | 人工步骤（`manual` 必填），支持多行 |
| `dependsOn` | | 前置项失败时**跳过本项检查**，避免级联误报 |
| `volatile` | | `true` = 会失效（token/登录态），每次都重查，不缓存 |
| `cacheDays` | | 非 volatile 项的缓存天数，默认 7 |
| `minVersion` | | 从 check 输出里解析版本号并比较 |
| `expect` | | 对 check 输出做正则校验 |
| `approval` | | 有审批周期的必须写明，让用户提前知道要等多久 |
| `docs` | | 控制台/文档链接 |
| `timeoutMs` | | 默认 30000；带网络下载的检查要放宽 |

几个不能省的字段：

- **`volatile`** —— 区分"装一次永久成立"和"会过期"。否则要么每次都慢，要么某天悄悄失效。
- **`dependsOn`** —— 没有它，缺凭据时会连带产生一串 `file not found` 之类的误导性报错，报告立刻变得不可读。
- **`approval`** —— 用户最怕搞了半小时才发现"这个 key 得等两天"。

检查命令可用的环境变量：`$SKILL_DIR`、`$CONFIG_DIR`、`$ENV_FILE`，以及凭据文件里的全部变量。

## 安全约定

- preflight **只报告变量存在与否，绝不打印值**。
- 凭据只写入 `~/.config/agent-skills/<name>/env`，不回显、不进仓库、不贴进对话。
- 任务产物放工作区 `outputs/` / `work/`，不放 skill 目录。
- 业务脚本对含 `token|secret|password` 的字段做 redact。

## 加一个新 skill

1. `mkdir -p skills/<name>/{scripts/checks,references}`，写 `SKILL.md` + `requirements.json`
2. SKILL.md 第一节复制现有 skill 的门禁节，把 `{NAME}` 换掉
3. `./tools/sync-core.sh` 把 preflight/setup 同步进去
4. `node skills/<name>/scripts/preflight.mjs --explain` 检查渲染出来的说明是否准确
5. 在一台**没配过**的机器（或临时改 `AGENT_SKILLS_HOME` 指向空目录）上跑一次，确认 BLOCKED 时的引导是可执行的

## 已知取舍

- **preflight/setup 是复制而非共享库。** 因为每个 skill 必须能被单独安装——Codex 的 skill-installer 只拉 `skills/<name>`，一旦 import `../../lib/` 就会在单独安装时断掉。代价是改模板后必须跑 `tools/sync-core.sh`。
- **`requirements.json` 是新增的事实源**，可能和 SKILL.md 散文不同步。所以散文里**不重复列举前提**，需要人类可读版本时用 `preflight.mjs --explain` 现渲染。
- **写权限无法只读检查。** 只能声明"读已就绪"，第一次写入被拒时才会暴露。清单里用 `guide` 写明这一点，不要假装检查过了。
