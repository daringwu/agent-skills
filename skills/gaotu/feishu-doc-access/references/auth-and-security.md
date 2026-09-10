# Feishu Authorization And Data Safety

## Access Models

### Temporary user OAuth via `lark-cli auth login`

Use when an Agent needs to read documents visible to the user, especially private wiki/docx pages and edit history.

Observed behavior in this environment:
- access token lifetime: about 2 hours
- refresh token lifetime: about 7 days
- credentials are stored locally under the user's `lark-cli` config/cache
- user identity is explicit, e.g. `whoami` shows `onBehalfOf.userName`
- user can revoke locally:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> auth logout
```

Important language to use with the user:
- “This is OAuth user authorization, not permanent unlimited access.”
- “The short-lived access token is about 2 hours; the refresh window is about 7 days in the current CLI status.”
- “I will request only the scopes needed for this task.”
- “The authorization can be revoked with `auth logout` or from Feishu account/app authorization management.”

### Identity boundary

This skill is user-only. Never execute a Feishu document operation as bot/app and never fall back to bot/app when user OAuth is unavailable. A profile may require application configuration to start OAuth, but the operation identity must still be `user`.

### Local existing profile

Use when `lark-cli whoami --profile <profile>` already works.

Recommended check:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> whoami
npx -y @larksuite/cli@1.0.90 --profile <profile> auth status
```

## Scope Safety Table

| Scope | Use | Sensitivity |
|---|---|---|
| `wiki:node:read` | Resolve wiki node to obj token and metadata | Low-medium; reveals wiki metadata |
| `docx:document:readonly` | Read docx content and use docs history helpers | High; grants document content read |
| `drive:drive.metadata:readonly` | Read Drive metadata like owner/latest modifier | Medium; metadata across accessible docs |
| `drive:file:download` | Download files or historical Drive versions | High; enables file content download |
| `drive:drive:version:readonly` | Read saved Drive file version list | Medium-high; version metadata |
| `drive:drive:version` | Broader Drive version access | Higher; request only if readonly is insufficient |
| `contact:user:search` | Map editor ids to display names | Medium; accesses contact search |

Ask before requesting contact scopes unless name mapping is essential.

## Revocation And Cleanup

Local logout:

```bash
npx -y @larksuite/cli@1.0.90 --profile <profile> auth logout
```

Config location observed:

```text
~/.lark-cli/config.json
```

Do not delete config automatically. Ask the user before removing profiles, tokens, or app configuration.

## Security Defaults

- Request minimum scopes incrementally.
- Explain each new scope before producing an OAuth QR/link.
- Treat verification URLs and device codes as short-lived secrets.
- Do not cache device codes in skill files.
- Do not store document exports under the skill directory.
- Prefer workspace `outputs/` for deliverables and `work/` for temporary analysis.
