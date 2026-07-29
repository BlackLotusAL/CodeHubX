# CodeHub CLI

面向 AI Agent、自动化脚本和 CI 的 CodeHub 命令行客户端。MVP 使用稳定的
`codehub.cli/v1` 机器协议封装现有 Project、Merge Request、Commit 和普通评论
API，并以显式写入确认保护唯一的写命令。

## 环境要求

- Node.js 22+
- Git 与已配置的 Git Credential Helper
- Linux 或 Windows（macOS 尽力兼容）

## 安装与开发

```bash
npm install
npm link
codehub version
```

运行测试与静态语法检查：

```bash
npm run check
npm test
```

## 快速使用

private token 只从 stdin 读取：

```bash
printf '%s' "$TOKEN" | codehub auth login --with-token
```

DevUC 非交互登录：

```bash
printf '%s' "$PASSWORD" | codehub auth login \
  --devuc \
  --account user123 \
  --password-stdin \
  --no-input
```

查询 Project 与 MR：

```bash
codehub repo list 123
codehub repo view 456
codehub mr list -R 456 --state open
codehub mr view 17 -R 456
codehub mr commits 17 -R 456
```

创建评论必须使用正文文件和显式确认。建议先运行 dry-run：

```bash
codehub mr comment create 17 \
  -R 456 \
  --body-file review.md \
  --severity major \
  --confirm-write \
  --dry-run
```

所有业务命令默认只向 stdout 输出一个 JSON 成功对象。失败时 stdout 为空，
stderr 只输出一个 JSON 错误对象。人工查看可增加 `--output human`。

## 配置

CLI 内置当前 CodeHub 与 DevUC 服务地址，可用以下环境变量覆盖：

- `CODEHUB_API_BASE_URL`
- `CODEHUB_API_APP_CODE`
- `CODEHUB_DEVUC_URL`
- `CODEHUB_DEVUC_APP_CODE`
- `CODEHUB_PRIVATE_TOKEN`
- `CODEHUB_AUTH_TOKEN`

URL 覆盖值必须使用 HTTPS。两个 token 环境变量不能同时设置。CLI 不创建明文
token 配置文件，也不会输出 token、密码或 AppCode。

成功与错误信封的 JSON Schema 位于
[`schemas/`](./schemas)。完整产品边界见
[`docs/product-requirements.md`](./docs/product-requirements.md)。
