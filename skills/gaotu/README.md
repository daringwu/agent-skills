# gaotu skills

依赖公司内部系统与鉴权的 skill：内部 API、内网域名、需要企业管理员审批的应用凭据。

这些 skill 在别的环境里装了也跑不通（preflight 会直接 BLOCKED），所以个人机器上可以只装 `personal/`。

```bash
./install.sh --scope gaotu
```
