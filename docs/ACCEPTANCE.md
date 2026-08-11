# CodeHub CLI 验收报告

验收基线：`docs/PRD.md` 与 `docs/API.md`。测试只使用内存替身、本地 mock 或一次性系统凭据记录，不访问真实 DevUC/CodeHub，不创建真实评论。

## 自动化检查

| 检查 | 命令 | 门禁 |
| --- | --- | --- |
| 语法 | `npm run check` | 所有发布与测试 JavaScript 可由 Node 解析 |
| 功能 | `npm test` | 单元、集成、真实子进程测试全部通过 |
| 覆盖率 | `npm run test:coverage` | statements、branches、functions、lines 均不低于 90% |
| npm 包 | `npm run test:package` | `npm pack`、临时安装和安装后 `codehub --help` 通过 |
| 系统凭据库 | `CODEHUB_KEYRING_SMOKE=1 node --test test/keyring-smoke.test.js` | 一次性记录 save/get/delete 通过并完成清理 |

Windows 与 Ubuntu 的 Node.js 22 检查由 `.github/workflows/ci.yml` 执行。Linux 系统凭据冒烟在临时 D-Bus/GNOME Keyring 会话内运行。

## 本次本地验收结果

验收日期：2026-08-12；本地平台：Windows。

- Node.js 24.14.1：78 项测试，77 通过、1 项按设计跳过（需显式启用的真实系统凭据测试），失败/取消为 0。
- Node.js 22.20.0：同一完整套件 77 通过、1 项按设计跳过，失败/取消为 0。
- 覆盖率：statements 99.13%、branches 94.62%、functions 96.68%、lines 99.13%。
- Windows Credential Manager：一次性记录 save/get/delete 冒烟通过，测试记录已清理。
- `npm pack`、临时安装和安装后 `codehub --help` 通过。
- 生产依赖审计：0 个已知漏洞。

Ubuntu 的真实执行由已提交的 CI 矩阵负责；本机没有 Linux 执行环境，因此本报告不虚构本地 Linux 运行结果。

## PRD 验收矩阵

| # | 验收要求 | 自动化证据 | 结果 |
| --- | --- | --- | --- |
| 1 | 七组 API 的 Method、URL、query、Header、body 一致 | `test/http-api.test.js` 的七组 API 请求捕获测试 | 通过 |
| 2 | `--project-id` 与 ID/state/body/severity 校验 | `test/validation-config.test.js`、`test/cli.test.js` | 通过 |
| 3 | 配置加载只检查 JSON 语法，配置失败统一分类 | 配置根类型、BOM、延迟校验、I/O 与损坏文件测试 | 通过 |
| 4 | 两种登录、状态、退出和 Credential Helper | `test/cli.test.js`、`test/credentials-transform.test.js`、系统凭据冒烟 | 通过 |
| 5 | DevUC 提前 5 分钟刷新及失败短路 | 刷新前一毫秒、精确边界、刷新/保存失败顺序测试 | 通过 |
| 6 | HTTP 零重试与评论结果未知 | 请求计数、redirect、timeout、连接重置、响应流中断测试 | 通过 |
| 7 | 成功结果逐命令定义且无通用信封/集中字段表 | 命令级直接 JSON 断言与字段白名单投影测试 | 通过 |
| 8 | JSON 错误字段和错误码受限 | 全错误类别 stdout/stderr、退出码和字段集合测试 | 通过 |
| 9 | human 颜色、宽度、时间、stderr | 中文/Emoji 对齐、窄终端、30 天边界、RFC 3339、颜色环境测试 | 通过 |
| 10 | 敏感信息与跨 host Header 不泄漏 | canary secret、URL 凭据、ANSI、Header 清理和登录输出测试 | 通过 |

## 明确限制

- 本报告不代表真实服务可用性或真实账号权限验证。
- 未执行 npm publish。
- 列表 API 不添加未记录的分页参数，因此结果可能不是全量。
- 评论 API 没有幂等或条件写保证；`WRITE_RESULT_UNKNOWN` 后必须人工检查。
