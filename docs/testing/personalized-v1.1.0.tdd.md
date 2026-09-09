# Levent 115 离线助手 v1.1.2：TDD 证据

## 用户旅程

- 用户粘贴由空格或换行混排的多个 magnet/ed2k 链接后，可以一次识别、去重并批量提交。
- 用户可以看到完整的保存目录名称，不再依赖被截断的下拉文字。
- 用户勾选自动清理并配置广告过滤词后，推送任务完成且目录确认时会批量清理文件及文件夹名称。
- 用户勾选自动删除空文件夹后，会在上述处理完成时清理任务目录中的空子文件夹。
- 用户的 115 凭据不会被复制到扩展本地存储，网页也不能伪造确认事件或选择任意网络目的地。

## RED / GREEN 记录

| 阶段 | 命令 | 结果 | 证据摘要 |
|---|---|---|---|
| RED | `npm test` | FAIL | 缺少 `offline-utils.js`、`security-utils.js`；manifest 名称、版本和权限范围不符合目标。 |
| GREEN | `npm run lint && npm test` | PASS | 21 项测试全部通过，JavaScript 语法检查通过。 |
| Coverage | `npm run test:coverage` | PASS | 生产纯函数行覆盖率 100%，分支覆盖率 86.49%，函数覆盖率 100%；测试文件已从汇总中排除。 |
| Browser QA | 本地 Playwright 弹窗模拟 | PASS | 4 条空格分隔磁链归一为 4 行并提交；长目录完整展示；广告词清理返回 3 项；无控制台错误或横向溢出。 |
| UI feedback | 本地 Playwright 弹窗模拟 | PASS | 重复目录行和旧清理按钮不存在；新复选框可勾选并保存，长目录在单个控件内换行展示。 |
| Batch monitor | 代码检查 + 本地弹窗模拟 | PASS | 批量提交的每条任务都会登记到 `chrome.storage.session` 和 `chrome.alarms`，下载完成并解析任务目录后才执行名称清理。 |
| Empty-folder cleanup | `tests/background-operations.test.js` + 代码检查 | PASS | 新复选框在现有整理/清理之后触发，按从里到外顺序删除任务目录内空子文件夹，不删除任务根目录。 |

## 测试规格

| # | 保证 | 测试文件 | 类型 | 结果 |
|---|---|---|---|---|
| 1 | 空格、换行混排的磁力链接可批量提取并去重 | `tests/offline-utils.test.js` | 单元 | PASS |
| 2 | magnet 参数和合法 ed2k 链接被完整保留 | `tests/offline-utils.test.js` | 单元 | PASS |
| 3 | Markdown 链接和反斜杠转义的过滤词会被规范化 | `tests/offline-utils.test.js` | 单元 | PASS |
| 4 | 清理不会生成空文件名 | `tests/offline-utils.test.js` | 单元 | PASS |
| 5 | 后台只允许预定义的 HTTPS 115 接口及方法 | `tests/security-utils.test.js` | 单元 | PASS |
| 6 | 登录响应仅保留 UID/CID/SEID，且向弹窗返回前移除 Cookie 明文 | `tests/security-utils.test.js` | 单元 | PASS |
| 7 | manifest 权限最小化且版本为专属 v1.1.2 | `tests/manifest.test.js` | 集成 | PASS |
| 8 | 网页确认使用 closed Shadow DOM 和可信用户手势 | `tests/ui-security-regression.test.js` | 安全回归 | PASS |
| 9 | 弹窗包含批量输入、完整目录展示和广告过滤配置 | `tests/ui-security-regression.test.js` | UI 合约 | PASS |
| 10 | 只有真正没有子项的目录才会被视为空文件夹 | `tests/offline-utils.test.js` | 单元 | PASS |

## 已知边界

- 自动化测试没有向真实 115 账户提交、删除或重命名数据；这些生产写操作刻意保持未执行。
- 115 接口属于非公开实现，若服务端更改响应结构，需要重新验证登录、批量任务和文件重命名流程。
- 名称清理限制为最多 5000 项、最多 10 层目录，并禁止从根目录执行。
