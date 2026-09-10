# Feishu/Lark Docs API Notes

These notes capture verified paths and commands from the 2026-08-16 investigation.

## CLI

Use:

```bash
npx -y @larksuite/cli@1.0.90 <domain> ...
```

Profile examples:

```bash
npx -y @larksuite/cli@1.0.90 --profile codex-feishu-history whoami
npx -y @larksuite/cli@1.0.90 --profile codex-feishu-history auth status
```

Initialize an app profile from existing env vars:

```bash
set -a; source /path/to/.env; set +a
printf '%s' "$FEISHU_APP_SECRET" | npx -y @larksuite/cli@1.0.90 \
  config init --app-id "$FEISHU_APP_ID" \
  --app-secret-stdin --brand feishu --name <profile>
```

Start user OAuth without blocking:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> auth login \
  --scope '<scopes>' --no-wait --json
```

Then generate QR:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> auth qrcode '<verification_url>' \
  --output outputs/feishu-auth-qrcode.png
```

After user confirms:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> auth login \
  --device-code '<device_code>'
```

## URL And Token Parsing

Common URLs:
- `https://...feishu.cn/wiki/<wiki_node_token>`
- `https://...feishu.cn/docx/<docx_token>`
- `https://...feishu.cn/docs/<doc_token>`

Resolve wiki:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  wiki spaces get_node --as user --token <wiki_node_token>
```

Underlying fields:
- `obj_token`
- `obj_type`
- `node_token`
- `space_id`
- `obj_edit_time`

## Read Current Content

CLI:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  docs +fetch --as user --doc '<url-or-token>' \
  --scope full --doc-format markdown --detail simple --format json
```

OpenAPI docx metadata:

```text
GET /open-apis/docx/v1/documents/{document_id}
```

OpenAPI raw content:

```text
GET /open-apis/docx/v1/documents/{document_id}/raw_content
```

## Edit History

Correct path for document edit history:

```text
GET /open-apis/docs_ai/v1/documents/{document_id}/histories
```

CLI wrapper:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  docs +history-list --as user --doc '<wiki-or-doc-url>' \
  --page-size 20 --format json
```

Response fields:
- `entries[].edit_time`: UTC ISO timestamp
- `entries[].editor_ids`: Feishu editor ids; not necessarily display names
- `entries[].history_version_id`
- `entries[].revision_id`
- `has_more`
- `page_token`

`scripts/feishu-doc-history.mjs` 生成的完整记录和每日汇总都会同时写入
`identity=user`、时区、页数、最终 `has_more`、`pagination_complete` 和固定 CLI
包版本，因而无需额外调用原始接口来证明用户身份和分页是否完整。

Fetch historical snapshot:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  docs +fetch --as user --doc '<url>' \
  --revision-id <revision_id> \
  --scope full --doc-format markdown --detail simple --format json
```

Outline snapshot:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  docs +fetch --as user --doc '<url>' \
  --revision-id <revision_id> \
  --scope outline --max-depth 3 --doc-format markdown --format json
```

## Drive Metadata

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> \
  drive metas batch_query --as user \
  --data '{"request_docs":[{"doc_token":"<obj_token>","doc_type":"docx"}],"with_url":true}'
```

Fields include:
- `create_time`
- `latest_modify_time`
- `latest_modify_user`
- `owner_id`
- `url`

## Drive Versions Are Different

Drive saved versions:

```text
GET /open-apis/drive/v1/files/{file_token}/versions
```

This can return `items: []` even when document edit history exists. It tracks Drive saved file versions, not every doc edit.

`lark-cli drive +version-history` dry-run showed:

```text
GET /open-apis/drive/v1/files/{file_token}/history?only_tag=true&page_size=...
```

This produced `file no exist` for wiki/docx online documents in the tested case. Prefer `docs +history-list` for edit history.

## Common Errors

### `missing_scope`

The OAuth user token lacks a scope. Request the minimum listed scope via `auth login --scope`.

Examples:
- `docx:document:readonly`
- `wiki:node:read`
- `drive:drive.metadata:readonly`

### `file no exist` on Drive history

Possible causes:
- wrong token type
- endpoint is for Drive files rather than online docx wiki content
- missing visibility/scope

Try wiki resolution, metadata query, then `docs +history-list`.

### `items: []` on `/versions`

Usually means no manually saved Drive versions. It does not mean there is no edit history.
