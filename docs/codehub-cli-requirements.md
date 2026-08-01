# CodeHub CLI 需求基线（ReviewX 视角）

- 文档状态：Draft
- 版本：0.1
- 更新日期：2026-07-30
- 需求来源：[ReviewX 产品需求文档](./product-requirements.md)
- 配套设计：[ReviewX 技术架构设计](./technical-architecture.md)

## 1. 产品定位

建议将 CodeHub CLI 定位为：

> 面向 AI Agent 和自动化系统的、具备稳定机器协议与安全写入门禁的 CodeHub 客户端，而不是优先追求 GitHub CLI 的全功能复刻。

ReviewX 明确由 Runner 管理基础设施和发布、Agent 只负责判断。产品目标还要求重复评论和发布到过期 head SHA 的数量均为 0。

## 2. 产品范围

### 2.1 P0：ReviewX 必需

- 仓库元数据、clone、fetch。
- 开放 MR 枚举和增量查询。
- MR 元数据、diff、commit、评论、inline discussion 读取。
- 一致性的 MR 上下文快照。
- 普通评论和 inline discussion 创建。
- 发布前 head SHA 条件校验。
- 服务端幂等写入。
- 稳定 JSON、结构化错误、分页、重试、限流信息。
- 读取凭据与发布凭据隔离。
- Agent 非交互模式和全局 `dry-run`。

### 2.2 暂不要求

- 创建、合并、批准、关闭 MR。
- Issue、Release、Wiki、Project 等 GitHub 全量能力。
- worktree 生命周期管理，仍由 ReviewX Runner 负责。
- Agent 自由调用任意写 API。

## 3. 建议命令面

| 优先级 | 命令 | 用途 |
| --- | --- | --- |
| P0 | `codehub version --json` | CLI、协议和构建版本 |
| P0 | `codehub capabilities --json` | 检测 inline、幂等、条件写等能力 |
| P0 | `codehub auth status --json` | 当前身份、Token scope、过期时间 |
| P0 | `codehub auth setup-git` | 安全配置 Git 凭据 |
| P0 | `codehub doctor --json` | 验证网络、证书、认证和 API 兼容性 |
| P0 | `codehub repo get <repo> --json` | 仓库、默认分支和默认分支 SHA |
| P0 | `codehub repo clone <repo> <dir> [--mirror]` | 建立仓库缓存 |
| P0 | `codehub repo fetch <repo> --git-dir <dir> --sha <sha>` | 获取指定提交，支持 MR 隔离 worktree |
| P0 | `codehub mr list` | 枚举和增量扫描 MR |
| P0 | `codehub mr get <iid>` | 获取完整 MR 元数据 |
| P0 | `codehub mr diff <iid>` | 获取 patch 或结构化 diff |
| P0 | `codehub mr commits <iid>` | 获取 commit 列表 |
| P0 | `codehub mr comment list <iid>` | 获取普通 MR 评论 |
| P0 | `codehub mr discussion list <iid>` | 获取 inline thread、位置和 resolved 状态 |
| P0 | `codehub mr context <iid>` | 一次导出一致性 MR Context Package |
| P0 | `codehub mr head check <iid> --expect <sha>` | 发布前新鲜度检查 |
| P0 | `codehub mr comment create <iid>` | 创建普通评论 |
| P0 | `codehub mr discussion validate <iid>` | 只验证 inline 位置 |
| P0 | `codehub mr discussion create <iid>` | 创建 inline 评论 |
| P1 | `codehub api <endpoint>` | 高级命令未覆盖时的只读 API 逃生口 |
| P1 | `codehub schema show <command>` | 输出命令响应的 JSON Schema |

所有仓库相关命令统一支持：

```text
--hostname <host>
-R, --repo <repo-id|namespace/name|url>
--profile <credential-profile>
--output human|json|jsonl
--fields <field,...>
--jq <expression>
--no-input
--timeout <duration>
--retries <n>
--request-id <id>
```

可以借鉴 GitHub CLI 的字段选择和 `--jq`、`--body-file`/stdin、API 分页以及关闭交互提示等设计，但 CodeHub CLI 应进一步强化机器协议与安全门禁：

- [GitHub CLI JSON 格式化](https://cli.github.com/manual/gh_help_formatting)
- [GitHub CLI 评论 body-file](https://cli.github.com/manual/gh_pr_comment)
- [GitHub CLI 通用 API 与分页](https://cli.github.com/manual/gh_api)
- [GitHub CLI 非交互环境变量](https://cli.github.com/manual/gh_help_environment)

## 4. MR 读取需求

### 4.1 `mr list`

至少支持：

```text
--state open|closed|merged|all
--updated-after <RFC3339>
--updated-before <RFC3339>
--target-branch <branch>
--draft true|false
--author-type user|bot
--label <label>
--exclude-label <label>
--page-size <n>
--cursor <cursor>
```

每个 MR 必须返回：

```text
repo_id、id、iid
state、is_draft
title、description
author.id、author.username、author.type
source_branch、target_branch
base_sha、start_sha、head_sha
labels
created_at、updated_at
changed_files、additions、deletions
web_url
```

增量分页必须具有稳定排序，不因多个 MR 的 `updated_at` 相同而漏项。

### 4.2 `mr diff`

JSON 模式至少包含：

- diff version ID。
- 完整 `base_sha/start_sha/head_sha`。
- old/new path、文件状态、是否二进制。
- additions、deletions。
- hunks 及每行的 `old_line/new_line/type/text`。
- 每个可评论行对应的 opaque `position_token`。
- `truncated`、`original_size` 和后续获取方式。

不得静默截断 diff。原始 patch 应支持：

```bash
codehub mr diff 128 --format patch --output change.patch
```

### 4.3 `mr context`

这是最值得为 Agent 增加的复合命令：

```bash
codehub mr context 128 \
  -R 123456 \
  --include metadata,diff,commits,comments,discussions \
  --expect-head-sha a18c4e... \
  --output json
```

CLI 应在读取前后各校验一次 head SHA。中途发生变化时返回 `SNAPSHOT_CHANGED`，不得输出一个混合新旧版本的上下文。

## 5. 写入安全契约

ReviewX 发布命令必须类似：

```bash
codehub mr discussion create 128 \
  -R 123456 \
  --position-token pos_xxx \
  --body-file review.md \
  --expect-head-sha a18c4e... \
  --expect-state open \
  --idempotency-key reviewx:123456:128:a18c4e:F-001 \
  --output json
```

必须满足以下语义：

- `--expect-head-sha`：head 不一致时返回 `STALE_HEAD`，且绝不写入。
- `--idempotency-key`：相同 key、相同 payload 重试时只产生一条评论，并返回原评论。
- 相同 key、不同 payload：返回 `IDEMPOTENCY_CONFLICT`。
- inline 位置已失效：返回 `DIFF_POSITION_INVALID`，不得静默降级为普通评论。
- 降级必须由调用方显式指定，例如 `--fallback comment`。
- `--dry-run` 执行权限、head、payload、位置验证，但不产生任何写操作。
- Agent 模式下，所有写命令强制要求 expected head 和 idempotency key。

成功结果至少返回：

```json
{
  "created": true,
  "replayed": false,
  "comment_id": "98765",
  "mode": "inline",
  "head_sha": "a18c4e...",
  "idempotency_key": "reviewx:...",
  "web_url": "https://codehub/...",
  "request_id": "req-..."
}
```

## 6. 机器协议

成功输出建议统一为：

```json
{
  "schema_version": "codehub.cli/v1",
  "command": "mr.get",
  "cli_version": "1.0.0",
  "request_id": "req-123",
  "data": {},
  "page": null,
  "rate_limit": {
    "remaining": 987,
    "reset_at": "2026-07-30T04:00:00Z"
  },
  "warnings": []
}
```

约束：

- JSON 模式下 stdout 只能包含结果，进度和日志进入 stderr。
- Agent 模式错误时 stdout 为空，stderr 只有一个结构化错误对象。
- 时间统一使用 RFC 3339 UTC。
- SHA 必须返回完整值。
- 平台 ID 使用字符串，避免 JavaScript 大整数精度问题。
- 路径统一使用 `/`。
- 缺失字段使用 `null`，不能在不同命令中随意省略。
- 用户输入的标题、描述、评论必须保持普通字符串，禁止执行模板、ANSI 控制符或命令替换。
- Schema 版本独立于 CLI 版本；minor 版本只能新增兼容字段。

错误对象至少包含：

```json
{
  "error": {
    "code": "STALE_HEAD",
    "message": "MR head has changed",
    "retryable": false,
    "expected_head_sha": "a18c4e...",
    "actual_head_sha": "19ba20...",
    "http_status": 409
  },
  "request_id": "req-123"
}
```

建议稳定错误分类：

```text
INVALID_ARGUMENT
AUTH_REQUIRED
FORBIDDEN
POLICY_DENIED
NOT_FOUND
STALE_HEAD
SNAPSHOT_CHANGED
IDEMPOTENCY_CONFLICT
DIFF_POSITION_INVALID
RATE_LIMITED
TIMEOUT
NETWORK_ERROR
TLS_ERROR
SERVER_ERROR
RESPONSE_SCHEMA_ERROR
UNSUPPORTED_CAPABILITY
```

建议稳定退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或 Schema 错误 |
| `3` | 认证或配置错误 |
| `4` | 权限或本地策略拒绝 |
| `5` | 资源不存在 |
| `6` | 冲突、过期 head 或幂等冲突 |
| `7` | 限流或暂时不可用 |
| `8` | 网络、超时或 TLS 错误 |
| `9` | 服务端或响应协议错误 |
| `10` | 能力不支持 |
| `130` | 被取消 |

结构化错误码是程序判断的权威依据，退出码仅用于粗粒度脚本控制。

## 7. 认证与安全

- Reader Token 与 Publisher Token 必须使用不同 CodeHub scope。
- 支持 `reviewx-reader`、`reviewx-publisher` 等命名凭据 profile。
- Agent 环境只注入 Reader Token，并启用本地 `read-only` policy。
- Token 不允许通过命令行参数传递。
- `auth login` 仅允许人类在交互式终端中执行，通过方向键选择认证方式，并使用掩码输入 Token 或 DevUC 密码；不提供管道、重定向或命令行参数形式的非交互登录。
- clone/fetch 后 remote URL 和 `.git/config` 中不得包含 Token。
- `auth status` 永远不能显示 Token 原文。
- debug、HTTP trace、错误和响应头必须执行凭据脱敏。
- 默认校验 TLS；支持企业 CA 文件，但 Agent 模式禁止跳过证书校验。
- 自动重试只允许用于只读请求，或携带幂等键的写请求。
- 遵循 `Retry-After`，采用指数退避和 jitter，禁止无限重试。

## 8. CodeHub API 的硬性前置能力

最重要的结论是：

> 如果 CodeHub API 不支持服务端条件写入和服务端幂等，CLI 无法仅靠“先查询、再发布”保证 ReviewX 的 0 过期评论与 0 重复评论。

因此应同步向 CodeHub API 提出：

| API 能力 | 必要性 |
| --- | --- |
| 评论创建携带 `expected_head_sha` 或 MR version/ETag | 原子拒绝旧 head 评论 |
| 写请求携带 `idempotency_key` | 并发、超时和重试下防重复 |
| 相同 key 返回原资源 | 调用方可安全恢复 |
| diff line 的稳定 position token | 防止 Agent 自行计算错误位置 |
| 完整 base/start/head SHA | 绑定评论到具体 diff version |
| cursor 分页和稳定排序 | 防止扫描漏 MR |
| 限流 headers 和 `Retry-After` | 可控重试 |
| capability/version endpoint | 运行时判断功能支持情况 |

若暂时缺少前两项，ReviewX 只能保持 `dry-run`、`web` 或人工确认模式，不能宣称满足自动发布验收指标。

## 9. 核心验收用例

- 10,000 个开放 MR 分页扫描无遗漏、无重复。
- MR 更新期间执行 `mr context`，必须返回 `SNAPSHOT_CHANGED`。
- head 在检视完成后变化，发布返回 `STALE_HEAD`，CodeHub 中没有新增评论。
- 100 个并发相同幂等请求只产生一条评论。
- 相同幂等键配不同正文时全部拒绝后续请求。
- Reader Token 调用写命令返回 `FORBIDDEN`，日志不出现 Token。
- 非法或过期 inline position 不产生普通评论。
- 中文、Emoji、Markdown、引号、换行和 shell 特殊字符通过 `--body-file` 原样发布。
- 429、503、网络中断重试后不产生重复评论。
- 所有 JSON 输出通过发布版本对应的 JSON Schema 校验。
- 大 diff 被截断时必须显式标记，不能给 ReviewX 一个看似完整的数据集。

## 10. 非功能需求

### 10.1 稳定性与兼容性

- CLI 使用语义化版本。
- CLI 版本、机器协议版本和 CodeHub API 版本分别管理。
- minor 版本只能增加可选字段或能力，不能删除或重命名既有字段。
- 服务端新增未知枚举值时，CLI 不得崩溃，应返回标准化 `unknown` 和原始值。
- 提供每个命令的 JSON Schema 和兼容性测试样例。

### 10.2 并发与性能

- 配置、凭据和缓存必须支持多进程并发读取。
- 至少支持 ReviewX 默认的 8 个并发 CLI/API 会话。
- CLI 自身不得持有跨命令的隐式 MR 状态。
- 大列表支持 cursor 分页，大 diff 支持流式写文件。
- 每个请求必须具有确定的连接超时、总超时和最大重试次数。

### 10.3 可观测性

- 每次请求生成或接收 `request_id`。
- 支持调用方传入 `--request-id`，并向 CodeHub API 透传。
- 日志可以输出 JSON，但不得污染命令结果。
- 结果中返回请求次数、限流信息和重试次数。
- User-Agent 至少包含 CLI 版本和操作系统信息。

## 11. 推荐实施顺序

1. 完成 CodeHub API 能力盘点，确认条件写、幂等和 inline position。
2. 实现认证、配置、稳定 JSON、错误模型和 capability 检测。
3. 跑通 `repo` 与 MR 全只读链路。
4. 实现 `mr context` 一致性快照。
5. 实现带 expected head、幂等键和 dry-run 的评论发布。
6. 通过并发、重试、过期 head 和凭据泄漏测试后，再允许 ReviewX 自动回写。
7. 最后补充通用 `codehub api` 和其他 GitHub CLI 对标能力。
