# CodeHub CLI 产品需求文档

API 依据：[API 接口清单](./API.md)

## 1. 产品定位与目标

CodeHub CLI 面向 AI Agent、自动化脚本、CI 和内部开发者，封装 CodeHub 已提供的项目、Merge Request、Commit 和评论 API，并提供统一的配置、认证和输出方式。

产品目标：

- 通过 npm 安装后，在 Node.js 22+ 的 Windows 和 Linux 环境中使用 codehub 命令访问 CodeHub。
- 支持 Private Token 和 DevUC 两种认证方式。
- DevUC token 到期前自动刷新。
- 默认提供稳定 JSON，人工查看时支持 human 输出。

## 2. 功能与命令

### 2.1 API 映射

| API                | 命令或流程                                                  |
| ------------------ | ----------------------------------------------------------- |
| DevUC 授权         | `codehub auth login`、DevUC token 自动刷新                  |
| Group Project 列表 | `codehub repo list <group-id>`                              |
| Project 详情       | `codehub repo view <project-id>`                            |
| Project MR 列表    | `codehub mr list --project-id <project-id>`                 |
| MR 详情            | `codehub mr view <iid> --project-id <project-id>`           |
| MR Commit 列表     | `codehub mr commits <iid> --project-id <project-id>`        |
| 创建 MR 评论       | `codehub mr comment create <iid> --project-id <project-id>` |

本地管理命令：

- `codehub config init`：创建用户配置文件。
- `codehub auth status`：查看本地认证状态。
- `codehub auth logout`：删除本地认证凭据。

### 2.2 全局参数与输出约定

```text
--output <json|human>       输出格式，默认 json
--timeout <duration>        单次 HTTP 请求超时，默认 30s
--project-id <id>           指定 Merge Request 所属 Project
```

约定：

- timeout 接受正整数加 ms、s 或 m，例如 500ms、30s、2m。
- project-id 只适用于 Merge Request 命令。
- Project ID、Group ID 和 MR IID 必须为正整数字符串。
- MR IID 是 Project 内编号，不能替换为全局 MR ID。
- auth login 是人类交互命令，其他命令不得等待交互式输入。
- 帮助和 human 输出使用简体中文；JSON 字段名、错误码和枚举使用英文。
- JSON 成功结果直接写入 stdout，不使用额外信封。
- JSON 使用两空格缩进并以一个换行结束，不输出 ANSI、进度或调试文字。

## 3. 配置与认证

### 3.1 用户配置

codehub config init 在用户配置目录创建 codehub/config.json：

- Windows：`%APPDATA%\codehub\config.json`
- Linux：优先使用 `$XDG_CONFIG_HOME/codehub/config.json`，否则使用 `~/.config/codehub/config.json`

API 调用使用以下配置路径：

```json
{
  "devuc": {
    "endpoint": "<DevUC 授权地址>",
    "appCode": "<DevUC X-Apig-AppCode>"
  },
  "codehub": {
    "endpoint": "<CodeHub API 地址>",
    "appCode": "<CodeHub X-Apig-AppCode>"
  }
}
```

配置行为：

- 配置文件不存在、无法解析为 JSON 或在命令使用时缺少可用值，统一返回 CONFIG_ERROR。
- 配置加载阶段只检查文件能否解析为 JSON，不检查 JSON 根类型、字段集合或字段值。
- config init 不覆盖已有文件。
- JSON 成功结果为对象，包含 created、config_path。

### 3.2 登录

```bash
codehub auth login
```

- 登录必须在带 TTY 的终端中执行。
- CLI 提供 Private Token 和 DevUC 两种认证方式。
- Private Token 为空或包含换行符时在本地拒绝。
- DevUC 登录依次输入账号和密码；账号必须由字母和数字组成，使用明文输入，并在回车后保留提示和当前账号；密码使用掩码输入且完成后清除提示。
- DevUC 登录调用授权接口并读取响应中的 result.newToken。
- 授权响应缺少有效 newToken 时返回 AUTH_ERROR。
- Ctrl+C 取消登录时返回 CANCELLED。
- 登录成功后，认证凭据保存在 Credential Helper；DevUC 凭据包括刷新所需的账号、密码、token 和签发时间。
- 新登录替换当前认证类型；Credential Helper 保存失败时返回 AUTH_ERROR。
- JSON 成功结果为对象，包含 configured、authentication_type、api_host。

### 3.3 DevUC token 自动刷新

DevUC newToken 有效期为 24 小时。使用 DevUC 认证的业务命令在 token 到期前 5 分钟触发刷新，不运行后台任务。

刷新行为：

1. 未达到刷新时间时直接使用当前 token。
2. 达到刷新时间时，在 CodeHub 请求前调用一次 DevUC 授权接口。
3. 刷新成功后保存新 token 和新的签发时间，再发送原业务请求。
4. 刷新失败时返回 AUTH_ERROR，不使用旧 token，也不发送原业务请求。

单次命令最多尝试刷新一次。Private Token、auth login、auth status 和 auth logout 不触发自动刷新。

### 3.4 认证状态与退出

`codehub auth status`：

- 只读取本地凭据，不访问 CodeHub 或 DevUC。
- 显示是否登录、认证类型和 API host。
- JSON 成功结果为对象，包含 configured、authentication_type、api_host。

`codehub auth logout`：

- 删除完整认证记录，包括 DevUC 刷新所需的账号和密码。
- 不调用远端吊销接口。
- JSON 成功结果为对象，包含 credential_helper_cleared、api_host。

业务命令找不到凭据、Credential Helper 操作失败或 CodeHub 返回 401 时，统一返回 AUTH_ERROR。

## 4. 业务命令

`repo list` 与 `mr list` 不自行添加 API.md 未记录的分页参数，因此结果可能不是全量。

业务命令的列表结果直接输出数组，其他结果直接输出对象。所有平台 ID 输出为字符串；规定字段缺失时使用 null；服务端增加的无关字段不进入输出。

### 4.1 Project

#### `codehub repo list <group-id>`

- 调用 Group Project 列表 API。
- JSON 成功结果为数组，每项包含 repo_id、full_name、clone_urls、archived、updated_at。

#### `codehub repo view <project-id>`

- 调用单个 Project 详情 API。
- 不额外查询分支、成员或其他资源。
- JSON 成功结果为对象，包含 repo_id、full_name、clone_urls、archived、updated_at、default_branch、web_url。

### 4.2 Merge Request

#### `codehub mr list`

```bash
codehub mr list --project-id <project-id> \
  [--state open|closed|locked|merged|all]
```

- state 默认为 open；CLI 将 open 映射为服务端参数 opened，其余值原样传递。
- 非法状态返回 INVALID_ARGUMENT。
- JSON 成功结果为数组，每项包含 repo_id、mr_id、iid、title、state、is_draft、author、source_branch、target_branch、updated_at、web_url。

#### `codehub mr view`

```bash
codehub mr view <iid> --project-id <project-id>
```

- 调用单个 MR 详情 API。
- 不隐式获取 Commit、diff 或评论。
- JSON 成功结果为对象，包含 repo_id、mr_id、iid、title、state、is_draft、author、source_branch、target_branch、updated_at、web_url、description、labels、created_at、changes。

#### `codehub mr commits`

```bash
codehub mr commits <iid> --project-id <project-id>
```

- 调用 MR Commit 列表 API。
- 不调用本地 Git。
- JSON 成功结果为数组，每项包含 sha、title、message、author、committer、authored_at、committed_at、parent_shas。

### 4.3 创建 MR 评论

```bash
codehub mr comment create <iid> \
  --project-id <project-id> \
  --body <text> \
  [--severity suggestion|minor|major|fatal]
```

- body 必填且不能为空，正文按参数原样传递，不做 trim、模板渲染或 Markdown 转换。
- 只包含空格或换行的正文交给服务端判断。
- severity 默认为 suggestion，只接受 suggestion、minor、major 或 fatal。
- 请求发出后连接中断或超时，无法确认是否创建成功时返回 WRITE_RESULT_UNKNOWN。
- 服务端不提供条件写和幂等保证，人工再次执行可能创建重复评论。
- JSON 成功结果为对象，包含 comment_id、repo_id、mr_iid、severity、resolved、web_url。

### 4.4 Human 输出

- `--output human` 面向人工查看，不供程序解析。
- 列表先显示结果数量，再使用无外框卡片展示每一项，卡片之间以空行分隔；详情使用标题、元数据和内容区建立层级。
- 仓库卡片展示状态图标、ID、仓库路径、更新时间和起始列一致的 SSH/HTTPS clone URL，并明确标识 archived；MR 卡片展示状态图标、IID、标题、作者、源/目标分支和更新时间；Commit 卡片展示短 SHA、标题、作者、提交者、时间、父 SHA 和消息。
- MR 详情使用独立的变更、标签、描述和 Web 区域；新增与删除行数分别使用成功色和错误色。评论、配置和认证结果使用统一状态标题和缩进详情。
- 基础 ANSI 语义色固定为：青色用于 ID、SHA 和 URL，绿色用于成功、活跃和新增，黄色用于警告、draft、locked、archived 和 minor，洋红色用于 merged、标签和 major，红色用于失败、closed、fatal 和删除，暗色用于字段名、时间和空值。
- 图标语义固定为 `✓` 成功或已合并、`●` 活跃、`○` 中性或空状态、`!` 警告、`✗` 失败或关闭、`→` 分支方向；图标和颜色只增强含义，旁边必须保留可读文字。
- 列表时间使用相对时间，超过 30 天显示日期；详情时间使用 RFC 3339 UTC。
- 只有真实 TTY 可以输出状态色；重定向、`NO_COLOR`、`CLICOLOR=0` 或 `TERM=dumb` 时不得输出 ANSI，`CLICOLOR_FORCE` 可强制 human 颜色。
- 业务 API 命令仅在 human 且 stdout、stderr 都是真实 TTY 时显示加载动画。动画延迟 300ms 出现、写入 stderr，并在成功、失败或取消后清除；JSON、非 TTY、本地配置和认证命令不得显示动画。
- 输出根据终端宽度换行或截断，中文、全角字符和 Emoji 按实际显示宽度对齐。

## 5. 请求与 HTTP

DevUC 授权请求：

```text
X-Apig-AppCode: <config.devuc.appCode>
Content-Type: application/json
```

CodeHub 请求：

```text
X-Apig-AppCode: <config.codehub.appCode>
private-token: <token>
```

或：

```text
X-Apig-AppCode: <config.codehub.appCode>
X-Auth-token: <newToken>
```

请求规则：

- private-token 和 X-Auth-token 不得同时发送。
- 默认超时为 30 秒，可通过 timeout 参数调整。
- 每个 HTTP 请求最多发送一次，网络失败后不自动重试。

## 6. 错误处理

### 6.1 JSON 错误结果

失败时 stdout 为空，stderr 只输出一个错误对象：

```json
{
  "code": "HTTP_ERROR",
  "message": "CodeHub request failed.",
  "http_status": 403
}
```

错误对象包含 code、message，并仅在收到 HTTP 响应时包含 http_status。

错误码：

| code                 | 场景                                           |
| -------------------- | ---------------------------------------------- |
| INVALID_ARGUMENT     | 命令参数无效                                   |
| CONFIG_ERROR         | 配置不存在、无法解析或无法使用                 |
| AUTH_ERROR           | 未登录、凭据操作失败、登录/刷新失败或 HTTP 401 |
| HTTP_ERROR           | 非 401 HTTP 失败或服务端响应无法使用           |
| NETWORK_ERROR        | 连接、TLS 或超时失败                           |
| WRITE_RESULT_UNKNOWN | 评论请求已发出但结果无法确认                   |
| CANCELLED            | 用户取消                                       |

### 6.2 Human 错误结果

- 失败时 stdout 为空，stderr 输出简洁的简体中文错误信息。
- 输出包含对应的稳定错误码；收到 HTTP 响应时可以显示状态码，但不固定文案模板。
- 错误图标、错误码、正文和 HTTP 状态分别渲染；一般失败使用红色 `✗`，`WRITE_RESULT_UNKNOWN` 使用黄色 `!`，取消使用中性 `○`，不得将整行信息染成同一种颜色。
- 颜色和 ANSI 行为遵循 4.4 节的 Human 输出规则。
- 错误分类和退出码与 JSON 模式一致。

### 6.3 退出码

| 退出码 | 含义                                |
| ------ | ----------------------------------- |
| 0      | 成功                                |
| 2      | INVALID_ARGUMENT                    |
| 3      | CONFIG_ERROR、AUTH_ERROR            |
| 4      | HTTP_ERROR                          |
| 8      | NETWORK_ERROR、WRITE_RESULT_UNKNOWN |
| 130    | CANCELLED                           |

## 7. 安全要求

- Private Token 和 DevUC 密码在登录向导中使用掩码输入。
- DevUC 账号使用明文输入，提交后保留提示和当前账号，因此账号会进入终端滚动记录。
- 认证秘密不得通过命令参数或环境变量输入；CLI 自身生成的状态和错误结果不得包含密码、token 或 AppCode。
- CLI 不对成功结果执行敏感字符串替换或 URL userinfo 移除；API 提供方负责确保返回字段适合直接输出，调用方负责保护管道、重定向和 CI 日志。
- Human 输出过滤 ANSI 和终端控制字符；JSON 对终端控制字符使用无损 Unicode 转义，解析后的业务值不得改变。
- 认证和刷新所需凭据只持久化在 Credential Helper 中。
- 跨 host 重定向必须移除认证 Header。

## 8. 验收标准

1. 七组 API 的 Method、URL、query、Header 和 JSON body 与 API.md 一致。
2. MR 命令使用 `--project-id`，ID、state、body 和 severity 校验符合命令约定。
3. 配置文件只在加载时检查 JSON 语法；配置相关失败统一返回 CONFIG_ERROR。
4. Private Token 与 DevUC 均可登录、查看状态和退出，凭据保存在 Credential Helper。
5. DevUC token 在到期前 5 分钟刷新；刷新成功后使用新 token，失败时终止原业务请求。
6. 每个 HTTP 请求最多发送一次；评论结果无法确认时返回 WRITE_RESULT_UNKNOWN。
7. 每个本地命令和业务命令旁只定义一次 JSON 成功结果类型与字段，不保留集中字段表或通用成功示例。
8. JSON 错误只使用规定错误码及 code、message、可选 http_status。
9. Human 成功输出使用卡片、语义颜色和图标，正确处理 ANSI、宽度、字符对齐与 TTY 加载动画；Human 错误只写 stderr，并包含稳定错误码。
10. DevUC 账号明文显示并在提交后保留；成功输出保持投影后的 API 业务值及 URL userinfo 不变，同时阻止终端控制字符执行；跨 host 请求不携带认证 Header。
