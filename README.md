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

安装 CLI 后，由人类在 Windows PowerShell 或 Linux 终端中运行：

```bash
codehub auth login
```

CLI 会显示一个交互式登录向导：

1. 使用 `↑` / `↓` 选择 `Private Token` 或 `DevUC 账号`，按 `Enter` 确认。
2. 选择 Private Token 后输入 token；选择 DevUC 后依次输入账号和密码。
3. token 和密码使用掩码显示。登录成功后，认证 token 保存到 Git Credential Helper。

按 `Ctrl+C` 可取消登录。登录必须由人类在真实交互式终端中完成，不支持通过 stdin
管道或重定向提供凭据，也不支持 `--no-input` 或认证参数。未登录的 AI Agent 执行业务命令时会
收到 `AUTH_REQUIRED`，应提醒人类先完成上述登录。

查询 Project 与 MR：

```bash
codehub repo list 123
codehub repo view 456
codehub mr list -R 456
codehub mr list -R 456 --state all  # 显式查询历史 MR
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

`mr list` 默认只查询开放 MR。所有业务命令默认只向 stdout 输出一个使用两空格
缩进的 JSON 成功对象；失败时 stdout 为空，stderr 只输出一个同样格式化的 JSON
错误对象。人工查看可增加 `--output human`。

JSON 只包含代码检视所需的稳定字段。例如仓库结果包含 SSH/HTTPS clone URL，MR
结果包含 IID、状态、作者、分支和更新时间，Commit 结果包含完整 SHA、消息、作者、
提交者、时间和父 SHA。reviewer、assignee、权限、成员数和其他服务端附加字段不会输出；
服务端缺失的规范字段以 `null` 表示。

human 模式使用无边框对齐布局、相对时间和终端宽度适配。颜色只在真实 TTY 中启用，
并遵守常见的 `NO_COLOR`、`CLICOLOR`、`CLICOLOR_FORCE` 和 `TERM=dumb` 约定；这些变量
只影响显示颜色，不会覆盖服务地址、AppCode 或认证配置。

## 配置

CLI 固定使用内置的 CodeHub、DevUC 服务地址和 AppCode，不支持通过命令行、
环境变量或配置文件覆盖，也不从环境变量读取认证 token。人类用户必须先执行
`codehub auth login` 完成登录，凭据由 Git Credential Helper 保存后，AI Agent 才能执行业务命令。

未登录时，业务命令返回 `AUTH_REQUIRED`，Agent 应提醒人类完成认证。CodeHub 服务地址或
AppCode 变更时需发布新的 CLI 版本。CLI 不创建明文 token 配置文件，也不会输出 token、
密码或 AppCode。

## 凭据与权限管理

Git Credential Manager（GCM）是 Git for Windows 常见的 Credential Helper。它把密码或
token 保存到操作系统的安全凭据存储中；它不是 CodeHub 的登录系统，也不应该替 CodeHub
CLI 弹窗收集认证信息。

CodeHub CLI 的权限流程如下：

1. 人类只在 `codehub auth login` 的终端向导中完成身份认证。
2. CLI 将认证类型和对应 token 保存为一条 `codehub-cli` Credential Helper 记录；DevUC
   账号密码不会保存。
3. `repo`、`mr` 等业务命令以禁止交互的方式读取这一条记录，根据认证类型发送
   `private-token` 或 `X-Auth-token` Header。
4. 找不到凭据时直接返回 `AUTH_REQUIRED`，不得打开 GCM、终端或浏览器登录窗口。
5. CodeHub 服务端根据 token 的实际 scope 决定权限；CLI 将未认证映射为 `AUTH_FAILED`，
   将权限不足映射为 `FORBIDDEN`，写命令还需要本地 `--confirm-write` 门禁。

旧版本分别保存的 `codehub-private-token` 和 `codehub-x-auth-token` 记录只会在禁止交互的
条件下读取一次并迁移到新记录，不会触发 GCM 窗口。

成功与错误信封的 JSON Schema 位于
[`schemas/`](./schemas)。完整产品边界见
[`docs/product-requirements.md`](./docs/product-requirements.md)。
