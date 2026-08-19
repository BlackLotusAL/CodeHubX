# CodeHub CLI

CodeHub CLI 是面向 AI Agent、自动化脚本、CI 和内部开发者的 CodeHub 命令行客户端。它封装 Project、Merge Request、Commit 和评论 API，并提供稳定的 JSON、交互式登录、系统凭据存储和可选 human 输出。

![CodeHub CLI 功能总览](docs/assets/codehub-cli-overview.png)

## 环境要求

- Node.js 22+
- Windows Credential Manager，或 Linux Secret Service（例如 GNOME Keyring/KWallet）
- 可访问组织内部的 DevUC 与 CodeHub API

## 安装

```bash
npm install --global codehub-cli
codehub --help
```

本地开发：

```bash
npm install
npm link
npm test
```

## 初始配置

运行：

```bash
codehub config init
```

该命令不会覆盖已有文件。新文件包含空占位值：

```json
{
  "devuc": {
    "endpoint": "",
    "appCode": ""
  },
  "codehub": {
    "endpoint": "",
    "appCode": ""
  }
}
```

请由人类编辑该文件并填入组织提供的地址和 AppCode：

- Windows：`%APPDATA%\codehub\config.json`
- Linux：`$XDG_CONFIG_HOME/codehub/config.json`，未设置时为 `~/.config/codehub/config.json`

配置只有在具体命令使用字段时才进行可用性校验；不存在、JSON 损坏或当前命令所需字段不可用均返回 `CONFIG_ERROR`。

## 认证

登录必须在真实 TTY 中由人类执行：

```bash
codehub auth login
```

可选择：

- Private Token：使用掩码输入，回车后终端保留提示和掩码，本地校验后保存到系统凭据库。
- DevUC：账号使用明文输入，回车后终端保留提示和当前账号以便确认；密码使用掩码输入，回车后同样保留提示和掩码。登录成功后，账号、密码、token 和签发时间保存在系统凭据库中，以便在 24 小时有效期结束前 5 分钟按需刷新。

凭据不接受命令行或环境变量输入，也不会保存到配置文件。Linux 缺少可用 Secret Service 时认证命令返回 `AUTH_ERROR`，不会降级到明文文件。

```bash
codehub auth status
codehub auth logout
```

`status` 和 `logout` 只操作本地凭据，不访问远端服务。

## 命令

```bash
codehub repo list <group-id>
codehub repo view <project-id>

codehub mr list --project-id <project-id> [--state open|closed|locked|merged|all]
codehub mr view <iid> --project-id <project-id>
codehub mr commits <iid> --project-id <project-id>
codehub mr comment create <iid> --project-id <project-id> \
  --body <text> [--severity suggestion|minor|major|fatal]
```

全局选项可以放在叶子命令之后：

```text
--output <json|human>  输出格式，默认 json
--timeout <duration>   单次请求超时，默认 30s；支持 ms、s、m
```

ID 必须是正整数字符串。评论正文不 trim、不做模板或 Markdown 转换；空字符串在本地拒绝，纯空白正文原样交给服务端。

## 输出与错误

默认成功结果为不带信封的 JSON，使用两空格缩进和单个结尾换行。失败时 stdout 为空，stderr 只包含：

```json
{
  "code": "HTTP_ERROR",
  "message": "CodeHub request failed.",
  "http_status": 403
}
```

稳定错误码为 `INVALID_ARGUMENT`、`CONFIG_ERROR`、`AUTH_ERROR`、`HTTP_ERROR`、`NETWORK_ERROR`、`WRITE_RESULT_UNKNOWN` 和 `CANCELLED`。

人工查看时使用：

```bash
codehub mr list --project-id 123 --output human
```

human 输出使用无外框卡片、语义颜色和状态图标。例如：

```text
共 1 个 Merge Request

● !17  修复终端输出对齐
  opened · 林开发者 · 1 天前
  fix/terminal-output → main
```

主要语义包括：绿色表示成功、活跃和新增，黄色表示警告、草稿或归档，洋红色表示已合并、标签或重要级别，红色表示失败、关闭和删除；ID、SHA 和 URL 使用青色，时间和其他辅助信息使用暗色。`✓`、`●`、`○`、`!`、`✗` 等图标旁始终保留文字，不依赖颜色表达含义。

业务 API 命令在真实交互终端中执行且超过 300ms 时，会在 stderr 临时显示加载动画，并在最终结果或错误输出前清除。JSON、管道、重定向以及配置和认证命令不会显示动画。

human 输出按终端宽度处理中文、全角字符和 Emoji。`NO_COLOR`、`CLICOLOR=0`、`TERM=dumb` 或重定向会关闭颜色；`CLICOLOR_FORCE` 可强制颜色。禁用颜色时不会产生 ANSI，卡片文字和图标仍保持可读。

成功结果不执行敏感字符串替换，也不移除 URL 中的用户名或密码。JSON 中的业务值与投影后的 API 返回值一致；human 输出仅过滤可能控制终端的 ANSI 和控制字符。API 提供方必须确保返回字段适合直接输出，并注意管道、重定向和 CI 日志可能持久化这些内容。

## 安全与写入语义

- Private Token 和 DevUC 密码在登录向导中使用掩码输入，提交后保留提示和掩码；DevUC 账号明文显示并保留在终端滚动记录中。
- 认证秘密不接受命令参数或环境变量输入，CLI 自身生成的状态和错误结果不包含密码、token 或 AppCode。
- CodeHub 的两个认证 Header 互斥发送。
- GET 跨 origin 重定向会移除认证 Header、AppCode、Authorization 和 Cookie。
- 所有 HTTP 请求均不自动重试。
- 评论 POST 不跟随重定向；请求可能已发出但响应无法确认时返回 `WRITE_RESULT_UNKNOWN`。人工重试可能创建重复评论。

## 开发与验收

```bash
# 快速、只读的语法、ESLint 与格式门禁
npm run check

# 显式修复 lint 与格式问题
npm run check:fix

# 快速执行功能测试
npm test

# 完整执行静态检查、90% 覆盖率门禁与安装包烟测
npm run verify
```

完整产品契约见 [PRD](docs/PRD.md) 和 [API 接口清单](docs/API.md)，测试映射见 [验收报告](docs/ACCEPTANCE.md)。
