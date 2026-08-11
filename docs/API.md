# API 接口清单

## 鉴权方式

所有 CodeHub API（API #2 ~ #7）支持两种鉴权方式：

1. **X-Auth-token**：通过 DevUC 授权（API #1）获取 `newToken`，在 Header 中携带 `X-Auth-token`
2. **private-token**：使用 CodeHub 私有 token，在 Header 中携带 `private-token`

所有请求需额外携带 Header：`X-Apig-AppCode`，其值来自 `config.codehub.appCode`。

## 配置字段

本文使用以下用户配置字段表示服务地址和 AppCode，CodeHub API 的各资源路径追加在 `config.codehub.endpoint` 之后：

| 配置字段                  | 用途                     |
| ------------------------- | ------------------------ |
| `config.devuc.endpoint`   | DevUC 授权接口的完整地址 |
| `config.devuc.appCode`    | DevUC `X-Apig-AppCode`   |
| `config.codehub.endpoint` | CodeHub API 的基础地址   |
| `config.codehub.appCode`  | CodeHub `X-Apig-AppCode` |

---

## 1. DevUC 授权

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `POST`                                                       |
| **URL**          | `${config.devuc.endpoint}`                                   |
| **请求 Headers** | `X-Apig-AppCode: <config.devuc.appCode>`                     |
| **请求 Body**    | ```json { "account": "<字母+数字>", "password": "<密码>" } ``` |
| **响应 Body**    | ```json { "result": { "newToken": "xxx", "token": "xxx" }, "status": "ok" } ``` |

DevUC 授权获得的 `newToken` 有效期为 **24 小时**。使用 `X-Auth-token` 鉴权的客户端须实现自动刷新 token

---

## 2. Group 中包含的 Project 列表

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `GET`                                                        |
| **URL**          | `${config.codehub.endpoint}/groups/<group_id>/projects`      |
| **请求 Headers** | `X-Apig-AppCode: <config.codehub.appCode>` + `private-token` 或 `X-Auth-token` |
| **请求 Body**    | 无                                                           |
| **响应 Body**    | 返回 Project 数组                                            |

**关键响应字段：**

| 字段                  | 类型              | 说明                 |
| --------------------- | ----------------- | -------------------- |
| `id`                  | number            | Project ID           |
| `name`                | string            | Project 名称         |
| `name_with_namespace` | string            | 带命名空间的完整名称 |
| `path_with_namespace` | string            | 带命名空间的完整路径 |
| `archived`            | boolean           | 是否已归档           |
| `ssh_url_to_repo`     | string            | SSH 仓库地址         |
| `http_url_to_repo`    | string            | HTTP 仓库地址        |
| `created_at`          | string (ISO 8601) | 创建时间             |
| `updated_at`          | string (ISO 8601) | 更新时间             |

---

## 3. 获取单个 Project 详情

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `GET`                                                        |
| **URL**          | `${config.codehub.endpoint}/projects/<project_id>`           |
| **请求 Headers** | 同上（同 API #2）                                            |
| **请求 Body**    | 无                                                           |
| **响应 Body**    | 返回 Project 完整详情对象                                    |

**关键响应字段（相比列表 API 额外返回）：**

| 字段                         | 类型              | 说明                                                    |
| ---------------------------- | ----------------- | ------------------------------------------------------- |
| `develop_mode`               | string            | 开发模式                                                |
| `default_branch`             | string            | 默认分支                                                |
| `visibility`                 | string            | 可见性（如 `private`）                                  |
| `security`                   | string            | 安全等级（如 `confidential`）                           |
| `web_url`                    | string            | 项目 Web 页面地址                                       |
| `readme_url`                 | string            | README 文件地址                                         |
| `star_count`                 | number            | 星标数                                                  |
| `forks_count`                | number            | Fork 数                                                 |
| `open_issues_count`          | number            | 未关闭 Issue 数                                         |
| `open_merge_requests_count`  | number            | 未关闭 MR 数                                            |
| `branch_count`               | number            | 分支数                                                  |
| `tag_count`                  | number            | 标签数                                                  |
| `member_count`               | number            | 成员数                                                  |
| `main_repository_language`   | array             | 主要编程语言                                            |
| `namespace`                  | object            | 命名空间信息（含 `id`, `name`, `full_path`, `kind` 等） |
| `creator`                    | object            | 创建者信息（含 `id`, `name`, `username`, `email` 等）   |
| `permissions`                | object            | 权限信息                                                |
| `_links`                     | object            | 相关资源链接（issues, merge_requests, branches 等）     |
| `container_registry_enabled` | boolean           | 是否启用容器仓库                                        |
| `issues_enabled`             | boolean           | 是否启用 Issue                                          |
| `merge_requests_enabled`     | boolean           | 是否启用 MR                                             |
| `jobs_enabled`               | boolean           | 是否启用 CI/CD                                          |
| `merge_method`               | string            | 合并方式（如 `merge`）                                  |
| `last_activity_at`           | string (ISO 8601) | 最后活跃时间                                            |

---

## 4. Project 中包含的 Merge Request 列表

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `GET`                                                        |
| **URL**          | `${config.codehub.endpoint}/projects/<project_id>/isource/merge_requests` |
| **请求 Headers** | 同上                                                         |
| **请求 Body**    | 无                                                           |
| **响应 Body**    | 返回 Merge Request 数组                                      |

**关键响应字段：**

| 字段              | 类型              | 说明                                              |
| ----------------- | ----------------- | ------------------------------------------------- |
| `id`              | number            | MR ID（全局）                                     |
| `iid`             | number            | MR 内部编号（项目内唯一）                         |
| `project_id`      | number            | 所属 Project ID                                   |
| `title`           | string            | MR 标题                                           |
| `description`     | string            | MR 描述                                           |
| `state`           | string            | 状态（`opened` / `closed` / `locked` / `merged`） |
| `target_branch`   | string            | 目标分支                                          |
| `source_branch`   | string            | 源分支                                            |
| `author`          | object            | 作者信息                                          |
| `assignee`        | object\|null      | 指派人                                            |
| `merge_status`    | string            | 合并状态（如 `cannot_be_merged`）                 |
| `web_url`         | string            | MR 页面地址                                       |
| `created_at`      | string (ISO 8601) | 创建时间                                          |
| `updated_at`      | string (ISO 8601) | 更新时间                                          |
| `merged_at`       | string\|null      | 合并时间                                          |
| `merged_by`       | object\|null      | 合并人                                            |
| `labels`          | array             | 标签列表                                          |
| `pipeline_status` | string            | 流水线状态                                        |
| `changes_count`   | string            | 变更文件数                                        |
| `added_lines`     | number            | 新增行数                                          |
| `removed_lines`   | number            | 删除行数                                          |

**查询参数：**

- `?state=<value>` — 按状态过滤，可选值：`opened` / `closed` / `locked` / `merged` / `all`（默认 `all`）

---

## 5. 获取单个 Merge Request 详情

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `GET`                                                        |
| **URL**          | `${config.codehub.endpoint}/projects/<project_id>/isource/merge_requests/<merge_request_iid>` |
| **请求 Headers** | 同上                                                         |
| **请求 Body**    | 无                                                           |
| **响应 Body**    | 返回单个 Merge Request 完整详情对象，字段参见 API #4         |

---

## 6. 获取 Merge Request 中包含的 Commit

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `GET`                                                        |
| **URL**          | `${config.codehub.endpoint}/projects/<project_id>/merge_requests/<merge_request_iid>/commits` |
| **请求 Headers** | 同上                                                         |
| **请求 Body**    | 无                                                           |
| **响应 Body**    | 返回 Commit 数组                                             |

**关键响应字段：**

| 字段             | 类型              | 说明                  |
| ---------------- | ----------------- | --------------------- |
| `id`             | string            | Commit SHA（完整）    |
| `short_id`       | string            | Commit SHA（短）      |
| `title`          | string            | Commit 标题（第一行） |
| `message`        | string            | Commit 完整消息       |
| `author_name`    | string            | 作者名称              |
| `author_email`   | string            | 作者邮箱              |
| `authored_date`  | string (ISO 8601) | 作者提交时间          |
| `committed_date` | string (ISO 8601) | 入库时间              |
| `parent_ids`     | array             | 父 Commit SHA 列表    |

---

## 7. 创建 Merge Request 评论

| 字段             | 内容                                                         |
| ---------------- | ------------------------------------------------------------ |
| **Method**       | `POST`                                                       |
| **URL**          | `${config.codehub.endpoint}/projects/<project_id>/merge_requests/<merge_request_iid>/discussions` |
| **请求 Headers** | 同上                                                         |
| **请求 Body**    | ```json { "body": "Testing", "severity": "major" } ```       |
| **响应 Body**    | 返回创建的 Discussion 完整对象                               |

**请求 Body 字段说明：**

| 字段       | 类型   | 必填 | 说明                                                         |
| ---------- | ------ | ---- | ------------------------------------------------------------ |
| `body`     | string | 是   | 评论内容                                                     |
| `severity` | string | 否   | 严重级别，可选值：`suggestion`（默认）、`minor`、`major`、`fatal` |

**关键响应字段：**

| 字段                | 类型    | 说明                               |
| ------------------- | ------- | ---------------------------------- |
| `id`                | string  | Discussion ID                      |
| `individual_note`   | boolean | 是否为独立评论                     |
| `notes`             | array   | 评论列表（包含作者、时间、内容等） |
| `project_id`        | number  | 所属 Project ID                    |
| `project_full_path` | string  | 项目完整路径                       |
| `severity`          | string  | 严重级别                           |
| `assignee`          | object  | 指派人                             |
| `proposer`          | object  | 提议人                             |
| `resolved`          | boolean | 是否已解决                         |
