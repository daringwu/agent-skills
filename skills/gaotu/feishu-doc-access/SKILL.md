---
name: feishu-doc-access
description: Access, read, export, and audit Feishu/Lark Docs, Wiki pages, Docx documents, Drive metadata, and document edit history using lark-cli or Feishu OpenAPI. Use when the user provides feishu.cn, larksuite.com, or org-specific Feishu wiki/docx/docs URLs or asks to read Feishu documents, fetch Feishu wiki content, inspect Feishu edit history, summarize document changes by date, compare historical revisions, resolve document tokens, or reason about temporary vs long-lived Feishu authorization and data-safety implications.
---

# Feishu Doc Access

## 门禁：每次使用本 skill 的第一步

1. 先运行 `node <本 skill 目录>/scripts/preflight.mjs`（如 `~/.codex/skills/feishu-doc-access/scripts/preflight.mjs`
   或 `~/.claude/skills/feishu-doc-access/scripts/preflight.mjs`）。**在它返回之前不要执行任何其他命令。**
2. 退出码：`0` = 全部能力就绪；`10` = 部分就绪；`20` = 全部阻塞；`2` = 清单/用法错误。
3. 退出码 `20`：**停下**。把输出整理成三段交给用户——AI 能直接做的 / 需要用户确认的 / 只能用户自己做的。
   不要尝试绕过，不要自行安装，不要改用浏览器、连接器或抓取等替代路径。
4. 退出码 `10`：只使用 READY 的能力，并明确告诉用户哪个能力不可用、缺什么。
   只关心某一个能力时用 `--capability <id>`，它会按该能力单独给出退出码。
5. 只安装 `requirements.json` 里 `tier: "auto"` 的项，方式是 `node <skill 目录>/scripts/setup.mjs`。
   它只执行清单里写死的命令。**绝不自己编 install 命令**；`tier: "assisted"` 有全局副作用，必须先向用户说明并取得同意（`--yes-assisted`）。
6. `tier: "manual"` 的项一律交给用户，不要代做，也不要猜测替代方案。
7. 凭据只写入 `~/.config/agent-skills/feishu-doc-access/env`（chmod 600）。不要回显值、不要写进仓库、不要贴进对话。
8. 要给用户看完整前提说明（不做任何检查）：`node scripts/preflight.mjs --explain`。

9. 涉及「填什么值」的判断前，先读 `policies/policy.json`。**其中 `value` 为 `null` 的项表示口径尚未定义——
   必须先问用户，绝不自行假设、绝不沿用 note 里的示例值。** 判断类口径读 `policies/*.md`。

前提条件的唯一事实源是 `requirements.json`，量化口径的唯一事实源是 `policies/policy.json`。
本文档两者都不重复列举，以免不同步。

Use this skill for Feishu/Lark document work: reading wiki/docx content, resolving wiki tokens, fetching metadata, pulling edit history, downloading/fetching revision snapshots, and explaining authorization safety.

Do not store Feishu app secrets, OAuth tokens, document bodies, or exported histories inside this skill. Keep task outputs in the current workspace `outputs/` or `work/`.

## Decision Tree

1. If the user asks about authorization, privacy, token lifetime, permanent vs temporary access, or security posture, read `references/auth-and-security.md`.
2. If the task needs exact Feishu endpoints, scopes, token types, or known failure modes, read `references/apis.md`.
3. If the task asks for full edit history or daily history aggregation, run or adapt `scripts/feishu-doc-history.mjs`.
4. If the task only needs current document text, use the user-login `lark-cli docs +fetch` workflow below first.
5. Preserve bot/app and direct OpenAPI workflows as fallbacks for explicit bot automation, service accounts, history tooling, or cases where the preferred user workflow cannot satisfy the request. Do not silently switch to a browser, connector, or scraper when the user chose `lark-cli`.

## Preferred Current-Document Workflow

For reading a current Wiki or Docx document, prefer a dedicated `lark-cli` profile authenticated by the user. Do not reuse a bot-oriented profile merely because it is already configured, and do not describe a bot profile's OAuth grant as the only way to use `lark-cli`.

### 1. Inspect profiles before authentication

```bash
npx -y @larksuite/cli@latest profile list
```

If a suitable user-oriented profile exists, use it. Check its login state with:

```bash
npx -y @larksuite/cli@latest --profile <profile> auth status
```

If the only available profile is an unrelated bot/app profile, do not authenticate through it without the user's explicit choice. Initialize a separate profile instead.

### 2. Initialize a dedicated profile when needed

Use the official interactive setup and give the new profile a distinct name:

```bash
npx -y @larksuite/cli@latest config init --name lark-cli-user
```

The user may choose one-click app setup or manually supply an existing Feishu app's App ID and App Secret. Keep any existing profiles intact. Never expose or copy the App Secret into task outputs or chat.

### 3. Log in as the user

Follow the normal `lark-cli` login flow:

```bash
npx -y @larksuite/cli@latest --profile lark-cli-user auth login --recommend
```

The user completes the displayed Feishu authorization page. If `--recommend` reports that a few unrelated scopes were not granted but stores a valid user token and the document scopes were granted, inspect `auth status` and proceed without repeatedly requesting the rejected scopes.

### 4. Fetch directly from the supplied URL or token

Do not resolve a Wiki node first unless metadata or a lower-level API operation requires it. `docs +fetch` accepts Wiki URLs, Docx URLs, and document tokens directly:

```bash
npx -y @larksuite/cli@latest --profile lark-cli-user \
  docs +fetch --doc '<wiki-url-docx-url-or-token>' \
  --doc-format markdown --detail simple --format json
```

Omit `--as` in this preferred flow and let the authenticated profile use its normal identity selection. Verify the response contains `"ok": true` and `"identity": "user"`. Save the complete JSON response, then extract `.data.document.content` as the Markdown deliverable.

Use `--doc-format xml` for structure-preserving or diff-friendly work and `--detail full` only when styles, block IDs, or edit metadata are required.

## Core Workflow

The following lower-level workflow remains available for metadata, history, explicit identity control, existing automation, and troubleshooting. It is not the first choice for simply reading the current document.

### 1. Resolve the document

For a wiki URL, first resolve the wiki node to an underlying object token:

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  wiki spaces get_node --as user --token <wiki_node_token> --format json
```

Useful fields:
- `node.obj_token`: underlying doc token, often `docx`
- `node.obj_type`: usually `docx`
- `node.obj_edit_time`: latest edit time
- `node.owner` / `node.creator`: Feishu open_id/user ids, not always display names

### 2. Read current document content

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  docs +fetch --as user --doc '<url-or-token>' \
  --scope full --doc-format markdown --detail simple --format json
```

For structured/diff-friendly snapshots, prefer `--doc-format xml`. For edit metadata, try `--detail full`.

### 3. Fetch document edit history

Use `docs +history-list`, not Drive file versions:

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  docs +history-list --as user --doc '<wiki-or-doc-url>' \
  --page-size 20 --format json
```

This calls:

```text
GET /open-apis/docs_ai/v1/documents/{document_id}/histories
```

It returns `edit_time`, `editor_ids`, `history_version_id`, `revision_id`, and pagination.

For full pagination and daily aggregation:

```bash
node <skill 目录>/scripts/feishu-doc-history.mjs \
  --doc '<wiki-or-doc-url>' \
  --profile <profile> \
  --out outputs/feishu-history
```

### 4. Fetch historical revision snapshots

Once history returns `revision_id`, fetch a snapshot:

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  docs +fetch --as user --doc '<wiki-or-doc-url>' \
  --revision-id <revision_id> \
  --scope full --doc-format markdown --detail simple --format json
```

Use outline snapshots to understand what changed by period:

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  docs +fetch --as user --doc '<url>' \
  --revision-id <revision_id> \
  --scope outline --max-depth 3 --doc-format markdown --format json
```

### 5. Metadata and Drive versions

Use Drive metadata for created/modified/owner fields:

```bash
npx -y @larksuite/cli@latest --profile <profile> \
  drive metas batch_query --as user \
  --data '{"request_docs":[{"doc_token":"<obj_token>","doc_type":"docx"}],"with_url":true}'
```

Do not confuse Drive file versions with document edit history:
- `drive/v1/files/{file_token}/versions` lists manually saved Drive versions and can return `items: []`.
- `drive +version-history` calls `/history` and may not work for wiki/docx online documents.
- For edit history, use `docs +history-list`.

## Authorization Rules

Before asking the user to authorize, explain the requested scopes and time window. Never imply OAuth access is permanent.

For current observed `lark-cli` OAuth behavior:
- access token expires in about 2 hours
- refresh token expires in about 7 days
- profile and refresh credentials are stored locally by `lark-cli`
- the user can revoke locally with `npx -y @larksuite/cli@latest --profile <profile> auth logout`

For long-lived app/bot access:
- app id/secret are long-lived credentials until rotated or revoked
- app scopes must be enabled in the Feishu developer console
- bot/app access is suitable for repeatable automation only when the app has explicit document permissions
- do not embed app secrets in skill files or final answers

Read `references/auth-and-security.md` for the scope table and recommended wording.

## Known Scopes

Common scopes encountered:
- `wiki:node:read`: resolve wiki node metadata
- `drive:drive.metadata:readonly`: batch query Drive metadata
- `docx:document:readonly`: read docx content and use docs history shortcuts
- `drive:file:download`: needed by Drive version download/history shortcuts
- `drive:drive:version:readonly` / `drive:drive:version`: Drive saved file versions, not doc edit history
- `contact:user:search`: map editor ids to user display names; ask before requesting this because it expands data access

## 输出口径

时区、是否解析编辑者姓名、产物目录、推断标注要求 —— 全部读 `policies/policy.json`。
需要判断的部分（编辑次数为何不能当工时、推断怎么标注、姓名解析的边界）读 `policies/reporting.md`。

不在这里重复口径值，会不同步。

## 两层结构

- **机制**（怎么调）：`references/apis.md`（命令、endpoint、报错）、`references/auth-and-security.md`（token 生命周期、scope 安全表）。
- **口径**（怎么输出）：`policies/policy.json` + `policies/reporting.md`，
  以及跨 skill 的 `policies/shared/work-attribution.md`（工作归因）。

## References

- `references/auth-and-security.md`: token lifetime, temporary vs long-term access, revocation, scope safety.
- `references/apis.md`: verified commands, endpoints, errors, and troubleshooting.
