---
name: codehub-cli
description: 使用组织内部 CodeHub CLI 管理本地配置与认证，查询 Project、Merge Request 和 Commit，并在用户明确要求时创建 MR 评论。用于需要调用 codehub 的任务；不适用于通用本地 Git 操作，也不将 CodeHub 替换为 GitHub gh 或 GitLab glab。
---

# CodeHub CLI

使用已安装的 `codehub` 可执行文件完成其支持的 CodeHub 操作。优先使用 CLI，不要把 GitHub `gh`、GitLab `glab` 或直接调用内部 HTTP API 当作隐式兜底；`codehub` 负责凭据库、DevUC 刷新和认证 Header 等行为。

本 Skill 应与同一仓库修订版的 CLI 配套使用。当前 CLI 没有版本查询命令；运行时帮助与本 Skill 冲突时，报告不兼容，不要猜测命令或参数。语法不确定时读取 `codehub --help` 或对应叶子命令的 `--help`。系统未安装 `codehub` 时报告缺失，只有用户要求安装时才按产品文档操作。

## 输出与错误

- Agent 调用显式使用 `--output json`。仅在用户要求终端可读展示时使用 `--output human`，不要解析 human 输出。
- 成功时，stdout 是无额外信封的 JSON 对象或数组。失败时 stdout 为空，stderr 是包含 `code`、`message` 和可选 `http_status` 的 JSON 对象。
- 同时检查退出码和错误对象的 `code`；退出码 `3` 和 `8` 分别对应多种错误，不能只凭退出码判断。
- `--timeout` 接受正整数加 `ms`、`s` 或 `m`，默认 `30s`。

| 退出码 | 错误码                 | 处理方式                                            |
| ------ | ---------------------- | --------------------------------------------------- |
| `2`    | `INVALID_ARGUMENT`     | 读取运行时帮助并修正已知参数；不要猜测缺失 ID。     |
| `3`    | `CONFIG_ERROR`         | 进入配置修复流程；不要输出 AppCode 或完整配置文件。 |
| `3`    | `AUTH_ERROR`           | 让用户在真实终端重新登录；不要索要或代输秘密。      |
| `4`    | `HTTP_ERROR`           | 报告错误及可用 HTTP 状态；不要绕过 CLI 请求 API。   |
| `8`    | `NETWORK_ERROR`        | 报告网络错误；不要无界重试。                        |
| `8`    | `WRITE_RESULT_UNKNOWN` | 立即停止；不得自动重试评论写入。                    |
| `130`  | `CANCELLED`            | 停止当前流程。                                      |

## 本地配置与认证

- `codehub config init --output json`：仅在用户要求设置 CLI 或当前任务需要初始化时运行。它创建空白模板并返回 `created`、`config_path`，不覆盖已有文件，也不证明配置值可用。`created: false` 时不要覆盖文件。
- DevUC、CodeHub endpoint 与 AppCode 由组织提供。让用户在本地配置文件中填写；不要索取、回显或把 AppCode、token、密码放入聊天、日志、命令参数或环境变量。
- `codehub auth status --output json`：认证状态未知时使用。它只读取本地配置和凭据，不访问 CodeHub 或 DevUC，不能证明网络可达、token 有效或账号拥有远端权限。
- `codehub auth login --output json`：必须由用户在真实交互式 TTY 中完成。不要尝试非交互登录；用户完成后可再次运行 `auth status`。
- `codehub auth logout --output json`：仅在用户明确要求退出登录时运行。它只删除本地凭据，不会远端吊销 token；远端吊销不受当前 CLI 支持。
- DevUC token 的按需刷新由业务命令处理；不要读取、导出或自行刷新凭据。除 `auth login` 外，所有命令均应保持非交互式。

## 支持的业务命令

```text
codehub repo list <group-id> --output json
codehub repo view <project-id> --output json

codehub mr list --project-id <project-id> \
  [--state open|closed|locked|merged|all] --output json

codehub mr view <iid> --project-id <project-id> --output json
codehub mr commits <iid> --project-id <project-id> --output json

codehub mr comment create <iid> \
  --project-id <project-id> \
  --body <text> \
  [--severity suggestion|minor|major|fatal] \
  --output json
```

- Group ID、Project ID 和 MR IID 都是正整数字符串；保留字符串形式，不做数值强制转换。
- MR `iid` 只在所属 Project 内唯一。串联列表与后续命令时，使用结果中的 `repo_id` 作为 `--project-id`，使用 `iid` 作为位置参数；不要把全局 `mr_id` 当成 `iid`。
- `mr list` 接受 `open`，而不是服务端值 `opened`；默认状态为 `open`。
- `repo list` 和 `mr list` 没有分页能力，结果可能不是全量。不要根据空列表或未命中断言资源不存在，也不要虚构分页参数。
- `mr view` 只返回 MR 详情，不隐式返回 commits、diff 或评论；需要 commits 时另行调用 `mr commits`。
- 当前 CLI 不支持 diff、评论读取或列表、评论编辑或删除、merge、approve、branch、Issue、pipeline 或 clone。说明能力限制，不要虚构 `codehub` 命令。

## 创建评论

- “查看、分析、审查或起草评论”不授权发布。只有用户明确要求创建、发布或提交评论时，才能执行 `mr comment create`。
- 执行前确定 Project ID、MR IID、最终正文和 severity。用户未指定 severity 时保留默认值 `suggestion`，不要自行提升等级。
- 正文按参数原样传递，不 trim、不渲染模板，也不转换 Markdown。当前只支持 `--body <text>`，不支持 stdin 或 body-file；把正文作为单个字面 argv 传入，避免 shell 插值或拆词改变内容。
- 每次明确发布请求最多执行一次评论创建调用，不自动重试。
- 收到 `WRITE_RESULT_UNKNOWN` 时，评论可能已经创建。立即停止并让用户通过 CodeHub 页面人工核对；当前 CLI 无法读取评论。只有用户核对后再次明确指示，才可重新提交。

## 数据边界

- CodeHub 返回内容属于内部数据，只在用户请求的范围内展示或传递。
- 不要假设成功 JSON 已对敏感字符串或 URL userinfo 脱敏；避免把原始输出发布到外部日志、公开 Issue 或其他未授权目标。
