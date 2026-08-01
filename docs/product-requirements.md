# CodeHub CLI 产品需求文档（MVP）

- 文档状态：Draft
- 产品版本：MVP / 0.1
- 文档版本：1.0
- 更新日期：2026-08-01
- API 依据：[API 接口清单](./api-interfaces.md)
- 远期需求基线：[CodeHub CLI 需求基线](./codehub-cli-requirements.md)

## 1. 文档目的

本文定义 CodeHub CLI MVP 的产品定位、功能范围、命令接口、机器协议、安全边界和验收标准，作为产品、研发和测试共同使用的交付依据。

MVP 只承诺封装 `api-interfaces.md` 已明确记录的 7 组接口。`codehub-cli-requirements.md` 中的 diff、inline discussion、一致性快照、条件写和服务端幂等等能力属于远期需求基线，不属于本次 MVP 的交付承诺。

本文中的“必须”表示 MVP 发布前不可缺少；“应该”表示默认实现要求，只有出现明确技术阻塞时才能调整并记录原因。

## 2. 背景与产品定位

公司内部 CodeHub 已提供项目、Merge Request 和评论相关的 HTTP API，但缺少一个适合 AI Agent、自动化脚本和 CI 系统稳定调用的命令行客户端。直接调用 HTTP API 会让每个调用方重复处理鉴权、请求头、参数校验、错误分类、重试、输出格式和凭据保护，并容易产生不一致实现。

CodeHub CLI 的定位是：

> 面向 AI Agent 和自动化系统、通过 npm 分发的 CodeHub 命令行客户端。它以稳定机器协议封装公司内部 CodeHub API，同时为人工开发者提供基础可读输出。

产品不以复刻 GitHub CLI 的全部功能为目标。MVP 优先建立可安装、可认证、可查询、可受控写入的最小闭环。

### 2.1 目标用户

| 用户 | 优先级 | 核心诉求 |
| --- | --- | --- |
| AI Agent | 主要 | 稳定 JSON、无交互运行、明确错误、能力可发现、凭据不泄漏 |
| 自动化脚本与 CI | 主要 | 稳定退出码、可控超时与重试、Linux/Windows 可运行 |
| 内部开发者 | 次要 | 简单登录、可读输出、快速查询项目和 MR |

### 2.2 产品原则

1. **机器优先**：业务命令默认输出 JSON，输出结构和退出码可供程序稳定判断。
2. **能力真实**：只承诺现有 API 能保证的行为，不用客户端逻辑伪装服务端不具备的原子性。
3. **凭据最小暴露**：token 和密码不通过命令行参数传递，不进入日志、错误或结果。
4. **写入显式授权**：唯一写命令每次调用都必须显式确认，且不自动重试。
5. **保持薄封装**：MVP 保持服务端字段名称，避免过早建立庞大的独立领域模型。

## 3. MVP 目标与成功标准

### 3.1 产品目标

- AI Agent 能通过稳定 JSON 协议完成认证、项目查询、MR 查询、Commit 查询和受控评论发布。
- 已知 7 组 API 均有明确的 CLI 命令映射、输入校验、错误处理和测试覆盖。
- 用户可通过 npm 全局安装后直接使用 `codehub` 命令。
- CLI 可在 Node.js 22+ 的 Linux 和 Windows 环境中正式运行。
- private token 和 DevUC 两种认证方式均可使用，并支持复用 Git Credential Helper。

### 3.2 发布成功标准

| 维度 | MVP 标准 |
| --- | --- |
| API 覆盖 | `api-interfaces.md` 中 7 组 API 均有对应命令或认证流程 |
| 机器协议 | 所有 JSON 成功结果通过 `codehub.cli/v1` Schema 校验 |
| 错误协议 | JSON 模式失败时 stdout 为空，stderr 只有一个结构化错误对象 |
| 安全 | 自动化测试和发布验收中凭据泄漏数量为 0 |
| 写入门禁 | 缺少 `--confirm-write` 的评论创建请求 100% 在本地被拒绝 |
| 重试安全 | 评论 POST 在任何场景下最多发送 1 次 |
| 兼容性 | Node.js 22 的 Linux、Windows 安装和端到端测试全部通过 |

## 4. MVP 范围

### 4.1 API 与命令映射

| API | MVP 命令/流程 | 说明 |
| --- | --- | --- |
| DevUC 授权 | `codehub auth login` 交互向导 | 由人类选择 DevUC 并用账号密码换取 X-Auth-token |
| Group Project 列表 | `codehub repo list <group-id>` | 返回指定 Group 中的 Project |
| Project 详情 | `codehub repo view <project-id>` | 返回单个 Project |
| Project MR 列表 | `codehub mr list -R <project-id>` | 支持文档已确认的状态过滤 |
| MR 详情 | `codehub mr view <iid> -R <project-id>` | 返回单个 MR |
| MR Commit 列表 | `codehub mr commits <iid> -R <project-id>` | 返回 MR 包含的 Commit |
| 创建 MR 评论 | `codehub mr comment create <iid> -R <project-id>` | 创建普通 Discussion，受写入门禁约束 |

### 4.2 明确不在 MVP 范围内

- `repo clone` 和 `repo fetch`；仓库克隆与拉取继续直接使用 Git。
- MR diff、patch、上下文快照和 head SHA 新鲜度检查。
- 普通评论读取、inline discussion 读取和行级评论创建。
- 服务端条件写、幂等键以及重复评论防护。
- 创建、合并、批准、关闭或重新打开 MR。
- Issue、Release、Wiki、Project、流水线等 GitHub CLI 扩展能力。
- 通用 `codehub api` 逃生口和 `schema show` 命令。
- 多 CodeHub host、多凭据 profile 和跨环境切换。
- 未经 API 文档确认的自动分页、cursor 分页和增量扫描。
- Git worktree、仓库缓存和本地工作区生命周期管理。

## 5. 命令与交互需求

### 5.1 全局约定

可执行文件名固定为 `codehub`。所有业务命令支持以下全局参数：

```text
--output <json|human>       输出格式，默认 json
--request-id <id>           调用方提供的请求关联 ID
--timeout <duration>        单次 HTTP 请求超时，默认 30s
--no-input                  禁止任何交互式提示
-R, --repo <project-id>     指定 Project ID，仅仓库/MR 相关命令使用
```

约束：

- `--timeout` 接受正整数加 `ms`、`s` 或 `m`，例如 `500ms`、`30s`、`2m`。
- `--request-id` 只允许字母、数字、`.`、`_`、`:`、`-`，长度为 1～128 个字符；未提供时由 CLI 生成。
- 当前 API 未确认 request ID 请求头，MVP 只将其用于客户端输出和日志关联，不向服务端发送未经确认的自定义 Header。
- `--no-input` 模式下，任何缺失的交互输入都直接返回 `INVALID_ARGUMENT`，不得等待终端输入；`auth login` 是人类专用交互流程，始终拒绝 `--no-input`。
- 参数中的 Project ID、Group ID 和 MR IID 必须为正整数字符串；CLI 不把命名空间路径猜测或转换为 ID。
- 帮助文本和 human 输出使用简体中文；机器协议中的字段名、错误码和枚举使用英文。

### 5.2 本地能力命令

#### `codehub version`

返回以下信息：

- CLI 语义化版本。
- 机器协议版本 `codehub.cli/v1`。
- Node.js 运行时版本。
- 操作系统与 CPU 架构。

该命令不得读取凭据或发起网络请求。

#### `codehub capabilities`

返回机器可读的能力清单，至少包含：

- 当前支持的认证方式、读取命令和写入命令。
- `pagination_guaranteed: false`。
- `conditional_write: false`。
- `idempotent_write: false`。
- `inline_discussion: false`。
- `write_requires_confirmation: true`。
- `write_auto_retry: false`。

该命令不得读取凭据或发起网络请求。

### 5.3 认证命令

#### 人类交互登录

```bash
codehub auth login
```

- `auth login` 必须由人类在带 TTY 的 Windows PowerShell 或 Linux 终端中执行；stdin 或交互提示输出（stderr）不是 TTY 时返回 `INVALID_ARGUMENT`，不得读取管道内容。
- CLI 显示带颜色的标题、操作提示和认证方式列表。人类使用 `↑` / `↓` 选择 `Private Token` 或 `DevUC 账号`，按 `Enter` 确认。
- 选择 Private Token 后，CLI 提示输入 token，输入内容以掩码显示；空 token 和包含换行符的 token 必须在本地拒绝。
- 选择 DevUC 后，CLI 依次提示输入账号和密码。账号可见且必须为字母和数字组合，密码以掩码显示。
- `Ctrl+C` 取消登录并返回 `CANCELLED`，退出码为 `130`。
- `auth login` 不接受 `--no-input`，也不提供 token、账号、密码或认证方式的命令行选项；不支持任何非交互登录方式。
- private token 登录成功后将 token 交给 Git Credential Helper 保存。
- DevUC 密码仅用于本次请求，任何情况下都不得保存。认证成功后只保存响应中的 `result.newToken`，作为 X-Auth-token 使用。
- DevUC 返回成功状态但缺少 `newToken` 时返回 `RESPONSE_SCHEMA_ERROR`。

#### `codehub auth status`

- 显示是否已配置 Credential Helper 凭据、认证类型和 API host。
- 不显示 token 原文、掩码 token、账号密码或 AppCode。
- 由于现有 API 没有身份或 token 状态接口，该命令只检查凭据是否存在，不宣称 token 有效，并在 `warnings` 中返回 `CREDENTIAL_NOT_VERIFIED`。
- 不发起网络请求。

#### `codehub auth logout`

- 删除当前 CodeHub host 下由 CLI 保存的 private token 和 X-Auth-token。
- 不调用远端 token 吊销接口，因为现有 API 未提供该能力。

#### 凭据选择规则

1. 业务命令只读取 Git Credential Helper 中的当前凭据，不从环境变量读取 token。
2. 每次 `auth login` 只保留最后登录的认证类型，并清除 CLI 为同一 host 保存的另一种 token，避免选择歧义。
3. Git Credential Helper 中没有凭据时，业务命令返回 `AUTH_REQUIRED`，不发起网络请求；Agent 应提醒人类用户先执行 `codehub auth login`。
4. Git Credential Helper 不可用或拒绝保存时，登录返回认证配置错误；DevUC 密码和已获取 token 不写入其他文件作为降级。

### 5.4 Project 命令

#### `codehub repo list <group-id>`

- 调用 Group Project 列表 API。
- `data` 为服务端返回的 Project 数组。
- 当前 API 文档未确认分页参数、分页 Header 和默认上限，因此结果必须包含 `PARTIAL_LIST_POSSIBLE` warning。
- CLI 不自动追加未经文档确认的 `page`、`per_page` 或 cursor 参数。

#### `codehub repo view <project-id>`

- 调用单个 Project 详情 API。
- `data` 为服务端返回的 Project 对象。
- 不额外查询默认分支 SHA、成员或其他链接资源。

### 5.5 Merge Request 读取命令

#### `codehub mr list`

```bash
codehub mr list -R <project-id> \
  [--state open|closed|locked|merged|all]
```

- `--state` 默认值为 `all`。
- CLI 将 `open` 映射为服务端参数 `opened`，其余值原样映射。
- 非法状态在本地返回 `INVALID_ARGUMENT`。
- `data` 为服务端返回的 MR 数组。
- 与 `repo list` 相同，结果必须包含 `PARTIAL_LIST_POSSIBLE` warning。

#### `codehub mr view`

```bash
codehub mr view <iid> -R <project-id>
```

- 调用单个 MR 详情 API。
- `data` 为服务端返回的 MR 对象。
- 不隐式获取 Commit、diff 或评论。

#### `codehub mr commits`

```bash
codehub mr commits <iid> -R <project-id>
```

- 调用 MR Commit 列表 API。
- `data` 为服务端返回的 Commit 数组。
- 不调用本地 Git，也不检查 Commit 是否已存在于本地仓库。

### 5.6 创建 MR 评论

```bash
codehub mr comment create <iid> \
  -R <project-id> \
  --body-file <path|-> \
  [--severity suggestion|minor|major|fatal] \
  --confirm-write \
  [--dry-run]
```

必须满足：

- `--body-file` 必填且只能出现一次；值为 `-` 时从 stdin 读取至 EOF。
- 正文按 UTF-8 读取，除 JSON 传输所需编码外不做 trim、模板渲染、Markdown 转换或 Shell 展开。
- 空正文在本地拒绝；只包含空格或换行的非空正文原样交给服务端判断。
- `--severity` 默认为 `suggestion`，仅接受 API 已记录的四个枚举值。
- 无论是否指定 `--dry-run`，都必须显式提供 `--confirm-write`；缺少时返回 `POLICY_DENIED`。
- `--dry-run` 只校验参数、读取正文并生成脱敏请求预览，不发送任何 HTTP 请求。
- dry-run 输出正文 UTF-8 字节数、目标 Project/MR、severity 和将使用的认证类型，但不回显正文或凭据。
- 实际 POST 请求绝不自动重试。
- 网络中断或超时发生在请求发出之后、无法判断服务端是否已创建评论时，返回 `WRITE_RESULT_UNKNOWN`，并明确标记 `retryable: false`。
- 成功结果必须包含 `UNSAFE_WRITE_GUARANTEES` warning，说明服务端没有条件写和幂等保障，CLI 无法保证评论未发布到过期 head，也无法保证人工重试不产生重复评论。
- CLI 不把创建失败或位置能力缺失降级为其他形式的写入。

## 6. 认证、配置与请求协议

### 6.1 固定服务配置与凭据存储

MVP 面向单一公司 CodeHub 环境，固定内置 `api-interfaces.md` 记录的当前服务地址和 AppCode。CLI 不提供命令行参数、环境变量或配置文件来覆盖这些值，也不从环境变量读取认证 token。认证凭据只能通过 `codehub auth login` 写入 Git Credential Helper，业务命令只从 Credential Helper 读取。

要求：

- 内置服务 URL 必须为 HTTPS URL；MVP 不允许通过配置关闭 TLS 校验。
- AppCode、token 和密码均视为敏感信息并执行相同级别的输出脱敏。
- MVP 不创建包含 token 的项目级或用户级明文配置文件。

### 6.2 请求头

DevUC 请求必须携带：

```text
X-Apig-AppCode: <DevUC AppCode>
Content-Type: application/json
```

CodeHub API 请求必须携带：

```text
X-Apig-AppCode: <CodeHub AppCode>
private-token: <token>
```

或：

```text
X-Apig-AppCode: <CodeHub AppCode>
X-Auth-token: <token>
```

两个认证 Header 不得同时发送。凭据不得进入 URL、query string 或请求体。

### 6.3 HTTP 行为

- 默认单次请求超时为 30 秒。
- GET 请求遇到网络错误、HTTP 429 或可重试的 5xx 时，最多额外重试 2 次。
- GET 重试采用指数退避和 jitter；存在合法 `Retry-After` 时优先遵循。
- POST 请求重试次数固定为 0，不能通过参数或环境变量放宽。
- HTTP 4xx 除 429 外不自动重试。
- 不无限跟随重定向；跨 host 重定向不得携带认证 Header。
- 非 2xx 响应必须映射为结构化错误，不把 HTML 或纯文本错误页写入 stdout。
- 响应不是合法 JSON或缺少命令所需的顶层结构时返回 `RESPONSE_SCHEMA_ERROR`。

## 7. 机器输出协议

### 7.1 成功结果

JSON 成功结果固定为一个对象：

```json
{
  "schema_version": "codehub.cli/v1",
  "command": "mr.view",
  "request_id": "req-123",
  "data": {},
  "warnings": []
}
```

字段要求：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema_version` | string | MVP 固定为 `codehub.cli/v1` |
| `command` | string | 稳定命令标识，如 `repo.list`、`mr.comment.create` |
| `request_id` | string | 调用方提供或 CLI 生成 |
| `data` | object/array | 命令结果；保留服务端字段名称 |
| `warnings` | array | 非致命限制或风险，不能为空时才包含对应项 |

数据转换规则：

- API 已记录的 ID 字段转换为十进制字符串，包括 Project、MR、Discussion、用户、命名空间等 ID。
- Commit SHA 和 `parent_ids` 保持字符串。
- 已知字段保持服务端字段名称，不执行 snake_case/camelCase 转换。
- 服务端新增的未知字段原样保留，不因未知字段导致命令失败。
- JSON 模式不输出进度条、颜色、ANSI 控制符、调试日志或附加说明。

标准 warning：

| code | 使用场景 |
| --- | --- |
| `PARTIAL_LIST_POSSIBLE` | 服务端分页契约未知，列表可能不是全量 |
| `CREDENTIAL_NOT_VERIFIED` | 只确认凭据存在，未验证远端有效性 |
| `UNSAFE_WRITE_GUARANTEES` | 写接口不支持条件写和幂等 |

### 7.2 错误结果

JSON 模式失败时 stdout 必须为空，stderr 只输出一个 JSON 对象：

```json
{
  "schema_version": "codehub.cli/v1",
  "command": "mr.comment.create",
  "request_id": "req-123",
  "error": {
    "code": "POLICY_DENIED",
    "message": "Writing requires --confirm-write",
    "retryable": false,
    "http_status": null,
    "details": {}
  }
}
```

稳定错误码至少包括：

```text
INVALID_ARGUMENT
CONFIG_CONFLICT
AUTH_REQUIRED
AUTH_FAILED
FORBIDDEN
POLICY_DENIED
NOT_FOUND
RATE_LIMITED
TIMEOUT
NETWORK_ERROR
TLS_ERROR
WRITE_RESULT_UNKNOWN
SERVER_ERROR
RESPONSE_SCHEMA_ERROR
UNSUPPORTED_CAPABILITY
```

错误消息不得包含请求 Header、凭据、完整 DevUC 响应或可能携带凭据的 URL。

### 7.3 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数错误 |
| `3` | 认证或配置错误 |
| `4` | 权限或本地策略拒绝 |
| `5` | 资源不存在 |
| `7` | 限流或暂时不可用 |
| `8` | 网络、超时、TLS 或写入结果未知 |
| `9` | 服务端或响应协议错误 |
| `10` | 能力不支持 |
| `130` | 用户取消 |

调用方必须以结构化错误码作为精确判断依据，退出码仅用于粗粒度脚本控制。

### 7.4 human 输出

- `--output human` 面向人工查看，可使用表格和键值列表。
- human 模式失败信息写入 stderr，退出码与 JSON 模式一致。
- human 输出不得显示 token、AppCode、密码或完整认证 Header。
- human 格式不承诺供程序解析；Agent 和脚本必须使用默认 JSON。

## 8. 安全与隐私要求

- token 和密码不得作为命令行参数或管道输入，只能由人类在登录向导的掩码输入框中输入。
- 登录向导必须要求 stdin 和提示输出均连接真实交互式终端，并兼容 Windows PowerShell 和 Linux 终端。
- DevUC 密码不得落盘、缓存或写入 Git Credential Helper。
- CLI 调用 Git Credential Helper 时必须通过 stdin 传递协议数据，不把 token 拼接进子进程参数。
- 日志、错误、HTTP trace、测试快照和异常堆栈必须统一执行凭据脱敏。
- remote URL、输出结果和错误中的 URL 不得包含凭据。
- 默认不提供 `--insecure`、跳过证书验证或明文 HTTP 的选项。
- 评论正文作为普通 UTF-8 字符串处理，禁止执行模板、命令替换或 ANSI 转义。
- 认证 Header 只发送到配置的目标 host；重定向到其他 host 时必须移除。
- CLI 不采集遥测，不向 CodeHub 和 DevUC 以外的服务发送业务数据。

## 9. 非功能需求

### 9.1 运行与分发

- 使用 npm 包分发，可执行文件固定为 `codehub`。
- 最低运行时为 Node.js 22。
- 正式支持 Linux 和 Windows；macOS 只做尽力兼容，不作为 MVP 发布阻塞条件。
- npm 包名由内部发布规范确定，不影响命令名。
- CLI 使用语义化版本；机器协议版本独立管理。

### 9.2 兼容性

- `codehub.cli/v1` 内不得删除、重命名或改变既有信封字段语义。
- minor 版本可以新增可选字段、warning 或 capability。
- 服务端增加未知响应字段时 CLI 不得崩溃。
- 服务端返回未知枚举时应保留原始值，不擅自映射为已知值。

### 9.3 稳定性与并发

- 每次命令执行均为独立进程，不依赖上一次命令保留的内存状态。
- 除 Git Credential Helper 中的凭据外，不持有跨命令的隐式业务状态。
- 多个只读命令可并发运行；不得用全局临时文件传递 token。
- 本地命令 `version` 和 `capabilities` 不依赖网络或认证。
- 收到终止信号时尽快取消未完成请求并返回退出码 `130`。

### 9.4 可观测性

- 每次命令生成或接收一个 request ID。
- 调试日志只能写入 stderr，且不得污染 JSON 错误对象；MVP 默认不输出调试日志。
- 每次重试应在 human 模式下提供不含敏感信息的提示；JSON 最终结果可在 `warnings` 中说明发生过重试。
- User-Agent 至少包含 CLI 版本、Node.js 版本和操作系统。

## 10. API 前置能力与已知限制

以下能力缺失不会阻塞 MVP，但会限制 CodeHub CLI 成为安全的自动化 Review 发布工具：

| 待补 API 能力 | 当前影响 | 后续可解锁能力 |
| --- | --- | --- |
| 稳定分页与分页元数据 | 列表无法保证全量 | 全量扫描、增量扫描 |
| MR 完整 base/start/head SHA | 无法绑定精确 diff 版本 | head 检查、上下文快照 |
| MR diff 与结构化行位置 | 无法读取变更和定位行 | diff、inline review |
| 评论与 discussion 读取 | 无法发现已有反馈 | 评论同步、去重辅助 |
| 稳定 inline position token | 无法安全创建行级评论 | inline discussion |
| 原子 `expected_head_sha` | 无法阻止向旧 head 发布 | 条件写 |
| 服务端 `idempotency_key` | 超时和重试可能重复写入 | 安全重试、并发去重 |
| 身份与 token 元数据 | `auth status` 不能验证身份、scope、过期时间 | 完整认证诊断 |
| capability/version endpoint | 只能由 CLI 静态声明能力 | 运行时兼容性检测 |

在条件写和服务端幂等实现之前，CLI 不得宣称达到“零过期评论”或“零重复评论”。上层 Agent 和 Runner 应将 MVP 评论命令视为受控但非原子安全的写接口。

## 11. 测试与验收

### 11.1 API 映射测试

为 7 组 API 分别验证：

- Method、URL path、query 参数和 JSON body 正确。
- DevUC 与 CodeHub 使用各自的 AppCode。
- private token 和 X-Auth-token 使用正确且互斥的 Header。
- 正常响应、非 JSON 响应、缺失字段和 HTTP 错误均映射到预期结果。
- 已知 ID 转换为字符串，未知字段得到保留。

### 11.2 认证与凭据测试

- 登录向导可通过方向键选择 private token 或 DevUC，敏感输入使用掩码显示，并能通过 Credential Helper 保存、读取和删除认证 token。
- 非 TTY、`--no-input` 和旧的非交互登录参数均在读取凭据前被拒绝；`Ctrl+C` 返回退出码 `130`。
- DevUC 密码在换取 token 后不可从文件、日志、错误或 Credential Helper 中检索到。
- 业务命令不读取 token 环境变量，只使用 Credential Helper 中的凭据。
- Credential Helper 中没有凭据时返回 `AUTH_REQUIRED`，且不发起网络请求。
- `auth login` 切换认证类型后不会留下两个可选的持久化凭据。
- Git 或 Credential Helper 不可用时返回明确错误且不降级为明文文件。
- `auth status` 和 `auth logout` 不泄露敏感值。

### 11.3 机器协议测试

- 每个命令的成功结果通过发布版本对应的 JSON Schema 校验。
- 所有失败场景验证 stdout 为空、stderr 只有一个错误对象。
- 每个稳定错误码映射到约定退出码。
- human 输出不影响 JSON 行为且不包含敏感信息。
- 中文、Emoji、Markdown、引号、反斜线、换行和 Shell 特殊字符能安全通过 JSON 协议。

### 11.4 网络与重试测试

- GET 遇到 429、503、连接重置和超时时最多重试 2 次。
- `Retry-After` 存在时优先遵循。
- 400、401、403、404 不重试并正确分类。
- 评论 POST 在成功、4xx、5xx、超时和连接中断场景下都最多发送 1 次。
- POST 已发出但结果未知时返回 `WRITE_RESULT_UNKNOWN` 和 `retryable: false`。
- 跨 host 重定向不携带认证 Header。

### 11.5 评论安全测试

- 缺少 `--confirm-write` 时不发送 HTTP 请求并返回 `POLICY_DENIED`。
- `--dry-run` 不发送 HTTP 请求，且不回显正文。
- 非法 severity、空正文、文件不存在和 stdin 读取失败在本地拒绝。
- 文件和 stdin 中的正文内容不被 trim、模板替换或 Shell 解释。
- 成功创建评论后返回 `UNSAFE_WRITE_GUARANTEES` warning。

### 11.6 发布验收

- 在 Node.js 22 的 Linux 和 Windows 环境完成 npm 安装、帮助、version、capabilities 和全部命令端到端测试。
- 使用模拟服务完成自动化测试，不依赖生产凭据。
- 发布候选版本在专用内部测试 Group、Project 和 MR 上执行一次受控冒烟测试。
- 冒烟测试不得使用生产 MR；测试评论应使用明确的测试标识，避免被误认为正式评审意见。

## 12. 交付阶段

1. **基础协议**：npm CLI 骨架、命令解析、JSON 信封、错误模型、request ID 和配置读取。
2. **认证闭环**：private token、DevUC、Git Credential Helper、status/logout 和凭据脱敏。
3. **只读能力**：Project、MR、Commit 命令以及 GET 超时和重试。
4. **受控写入**：评论门禁、body-file/stdin、dry-run、POST 禁止重试和结果未知处理。
5. **发布验证**：Linux/Windows 测试矩阵、内部测试环境冒烟、npm 包发布。

## 13. 风险与应对

| 风险 | 影响 | MVP 应对 |
| --- | --- | --- |
| API 分页行为未记录 | Project/MR 列表可能不完整 | 不承诺全量，固定输出 warning，并推动补充 API 契约 |
| 评论 API 无条件写和幂等 | 可能产生过期或重复评论 | 强制确认、不自动重试、返回明确 warning |
| DevUC token 有效期未知 | `auth status` 无法判断是否过期 | 只报告凭据存在性，401 时返回认证错误 |
| Git Credential Helper 未配置 | 无法持久化登录凭据 | 返回明确配置错误；由人类完成 Helper 配置和登录 |
| AppCode 或服务地址变化 | 内置配置失效 | 更新内置值、通过回归测试后发布新版本 |
| 服务端响应字段变化 | Agent 解析失败 | 稳定外层信封、保留未知字段、维护 Schema 兼容测试 |

## 14. 假设

- 目标环境已经安装 Git，以便复用 Git Credential Helper；Git 的 clone/fetch 能力不由本产品重复实现。
- 当前 `api-interfaces.md` 是 MVP 唯一可信的服务端能力来源，未记录的接口、参数和响应 Header 一律不作为交付承诺。
- 内部 npm 发布渠道和最终包名由发布规范确定，可执行文件名始终为 `codehub`。
- 本阶段不编写技术架构文档，不改变 `codehub-cli-requirements.md` 的远期需求内容。
