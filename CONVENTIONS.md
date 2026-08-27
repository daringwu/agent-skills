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

## 三层内容，不要混

一个 skill 里的文字有三种，变化速度和变化来源都不同，所以分开放：

| 层 | 位置 | 内容 | 谁驱动变化 |
|---|---|---|---|
| **门禁** | `SKILL.md` 第一节 | 用之前必须做什么、退出码怎么反应 | 本约定 |
| **机制** | `references/*.md` | endpoint、命令、字段语义、报错、限制 | 外部系统改 API |
| **口径** | `policies/` | 填什么值、什么算一个任务、上限是多少 | 你和团队改约定 |

判断依据：**「如果 TAPD 明天改了 API，这句话要改吗？」要改的是机制；不改但可能因为团队开会而改的，是口径。**

混在一起的代价很具体：改一次工时上限要去动 API 文档，而 API 文档是会被整段替换的。

### 口径层的两种形态

```
skills/<scope>/<name>/policies/
├── policy.json          # 量化、可校验、可被脚本读取
├── <topic>.md           # 需要判断、无法用一个数字表达
└── shared/<id>.md       # 从 policies/shared/ 同步的跨 skill 口径
```

`policy.json` 每条规则的形状：

```jsonc
"dailyHoursCap": {
  "value": null,                       // null = 尚未定义
  "note": "单日工时上限……",             // 用途
  "todo": "定一个数字。要问：上限是 8？…"  // 未定义时要问什么
}
```

**`value: null` 的语义是「必须先问用户」**，不是「用默认值」。这是处理"先拆出来，后完善"的诚实做法——把未定义显式记下来，而不是随手填一个看起来合理的数字。已定义的规则用 `source` 说明来源。

`tools/policy-todo.sh` 列出所有待定义项。

### 跨 skill 口径

工作归因（什么算一个任务、怎么从代码仓库归纳、工时怎么估）不属于任何单个工具——换掉 TAPD 或换掉飞书它都不变。母版放仓库根 `policies/shared/`，各 skill 在 `policies/policy.json` 的 `shared` 数组里声明需要哪些，`tools/sync-core.sh` 同步进去。

同步而非引用的原因和 preflight 一样：skill 必须能被单独安装。

### 硬规则

- SKILL.md 和 references **不得出现口径字面值**（包括命令示例里的）。示例用 `<policy:ruleName>` 占位。
- 口径不在散文里重复列举，需要人类可读版本时现读 `policies/`。
- **仓库里不出现任何环境专属的真实值**：项目 ID、迭代/任务 ID、账号字段、组织域名一律用 `<占位符>`。
  真实值属于机器级配置（`~/.config/agent-skills/<name>/env`）或现查 API。同一个理由：
  写死的值会不同步，而且让仓库变成需要脱敏才能给别人看的东西。

## 目录结构

顶层按 **scope** 分，判断标准是「换一家公司还能用吗」：

| scope | 内容 | 说明 |
|---|---|---|
| `skills/gaotu/` | 依赖内部 API、内网域名、需企业审批的凭据 | 换环境跑不通 |
| `skills/personal/` | 通用 skill | 任何机器可用 |

scope 只影响**仓库布局和安装筛选**，不影响运行时：
- 配置目录是 `~/.config/agent-skills/<skill-name>/`，key 只用 `requirements.json` 的 `name`，**不含 scope**。所以一个 skill 在 scope 之间移动不会丢凭据。
- 安装后是平铺的 `<target>/<name>`（各工具不认嵌套），因此**跨 scope 不能有同名 skill**，`install.sh` 会检查。

skill 内（进 git，无密）：

```
skills/<scope>/<name>/
├── SKILL.md                    # 第一节是门禁规则
├── requirements.json           # 唯一事实源，零依赖可解析
├── policies/                   # 口径层
│   ├── policy.json             # 量化口径，唯一事实源
│   ├── <topic>.md              # 判断类口径
│   └── shared/*.md             # 由 sync-core.sh 从 policies/shared/ 同步
├── scripts/
│   ├── preflight.mjs           # 由 tools/sync-core.sh 同步，勿直接改
│   ├── setup.mjs               # 同上
│   ├── checks/*.mjs            # 复杂检查放脚本，不塞进 JSON 字符串
│   └── <业务脚本>
└── references/*.md             # 机制层
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

1. 选 scope（`gaotu` 还是 `personal`），`mkdir -p skills/<scope>/<name>/{scripts/checks,references,policies}`，写 `SKILL.md` + `requirements.json` + `policies/policy.json`
2. SKILL.md 第一节复制现有 skill 的门禁节，把 `{NAME}` 换掉
3. `./tools/sync-core.sh` 把 preflight/setup 与声明的共享口径同步进去
4. `node skills/<scope>/<name>/scripts/preflight.mjs --explain` 检查渲染出来的说明是否准确
5. `./tools/policy-todo.sh` 确认没有漏掉该定义的口径
6. 在一台**没配过**的机器（或临时改 `AGENT_SKILLS_HOME` 指向空目录）上跑一次，确认 BLOCKED 时的引导是可执行的

## 已知取舍

- **preflight/setup 是复制而非共享库。** 因为每个 skill 必须能被单独安装——Codex 的 skill-installer 只拉单个 skill 路径，一旦 import 仓库里的 `lib/` 就会在单独安装时断掉。代价是改模板后必须跑 `tools/sync-core.sh`。
- **`requirements.json` 是新增的事实源**，可能和 SKILL.md 散文不同步。所以散文里**不重复列举前提**，需要人类可读版本时用 `preflight.mjs --explain` 现渲染。
- **写权限无法只读检查。** 只能声明"读已就绪"，第一次写入被拒时才会暴露。清单里用 `guide` 写明这一点，不要假装检查过了。
