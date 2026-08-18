# CodeHub CLI 验收报告

验收基线：`docs/PRD.md` 与 `docs/API.md`。测试只使用内存替身、本地 mock 或一次性系统凭据记录，不访问真实 DevUC/CodeHub，不创建真实评论。

## 自动化检查

| 检查       | 命令                                                             | 门禁                                                |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| 静态质量   | `npm run check`                                                  | 语法、ESLint 与 Prettier 检查全部通过               |
| 功能       | `npm test`                                                       | 单元、集成、真实子进程测试全部通过                  |
| 覆盖率     | `npm run test:coverage`                                          | statements、branches、functions、lines 均不低于 90% |
| npm 包     | `npm run test:package`                                           | `npm pack`、临时安装和安装后 `codehub --help` 通过  |
| 完整验证   | `npm run verify`                                                 | 静态质量、覆盖率和 npm 包门禁全部通过               |
| 系统凭据库 | `CODEHUB_KEYRING_SMOKE=1 node --test test/keyring-smoke.test.js` | 一次性记录 save/get/delete 通过并完成清理           |

Windows 与 Ubuntu 的 Node.js 22 主矩阵只调用 `npm run verify`，因此本地完整验证和 CI 使用同一 interface。系统凭据库测试保留为平台专用门禁；Linux 冒烟在临时 D-Bus/GNOME Keyring 会话内运行。

## 结果判定

本文档记录稳定的验收命令、最低门槛和行为证据，不记录会随正常开发变化的测试数量、执行日期或实时覆盖率。当前执行结果以对应提交的 CI 日志为准；任何主矩阵或平台专用门禁失败都表示该提交未通过验收。

## Human 输出专项验收

- 所有 public human 命令均覆盖有色与无色输出，卡片在禁用颜色时仍保留状态文字和图标。
- opened/merged/closed/locked、四级评论 severity、增删统计、标签、URL、空值和三类错误语义均有颜色断言。
- 40、80、240 列终端下的中文、全角字符、Emoji、长 URL 和 ANSI 注入测试均通过，所有行保持在终端宽度内。
- spinner 使用手动时钟覆盖 300ms 延迟、逐帧更新、快速完成不闪烁、成功/失败/取消清理、无残留 timer，以及 JSON、非 TTY 和本地命令完全静默。

## PRD 验收矩阵

| #   | 验收要求                                                                          | 自动化证据                                                                                                    |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 六组 CodeHub adapter 操作及 DevUC client 的 Method、URL、query、Header、body 一致 | `test/http-adapters.test.js` 的外部请求捕获测试                                                               |
| 2   | `--project-id` 与 ID/state/body/severity 校验                                     | `test/validation-config.test.js`、`test/cli.test.js`                                                          |
| 3   | 配置加载只检查 JSON 语法，配置失败统一分类                                        | 配置根类型、BOM、延迟校验、I/O 与损坏文件测试                                                                 |
| 4   | 两种登录、状态、退出和 Credential Helper                                          | `test/cli.test.js`、`test/credentials.test.js`、系统凭据冒烟                                                  |
| 5   | DevUC 提前 5 分钟刷新及失败短路                                                   | 刷新前一毫秒、精确边界、刷新/保存失败顺序测试                                                                 |
| 6   | HTTP 零重试与评论结果未知                                                         | 请求计数、redirect、timeout、连接重置、响应流中断测试                                                         |
| 7   | 成功结果逐命令定义且无通用信封/集中字段表                                         | 命令级直接 JSON 断言与字段白名单投影测试                                                                      |
| 8   | JSON 错误字段和错误码受限                                                         | 全错误类别 stdout/stderr、退出码和字段集合测试                                                                |
| 9   | human 卡片、语义颜色、图标、宽度、时间、spinner、stderr                           | `test/output.test.js`、`test/activity.test.js` 的全命令无色/有色、40/80/240 列、时间边界和 timer 生命周期测试 |
| 10  | 原样业务输出、终端安全与跨 host Header 清理                                       | SSH URL 用户名、URL userinfo、控制字符、Header 清理和 DevUC 登录提示测试                                      |

## 明确限制

- 本报告不代表真实服务可用性或真实账号权限验证。
- 未执行 npm publish。
- 列表 API 不添加未记录的分页参数，因此结果可能不是全量。
- 评论 API 没有幂等或条件写保证；`WRITE_RESULT_UNKNOWN` 后必须人工检查。
