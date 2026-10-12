# 项目隐私规则

- 始终使用简体中文回复，优先使用简体中文注释。
- 本项目提交身份固定为 `LeventLei <19942206+LeventLei@users.noreply.github.com>`。开始修改前执行 `sh scripts/setup-privacy.sh`；禁止沿用公司或个人真实邮箱。
- 禁止提交 Cookie、UID/CID/SEID 登录凭据、API Key、令牌、私钥、真实账号目录 CID、本机用户路径或包含上述信息的截图与日志。示例目录 CID 使用 `123456789`，示例凭据使用明确的短占位值。
- 隐私扫描结果只显示位置与规则，不打印实际敏感值。
- 提交前运行 `python3 scripts/check-privacy.py`，推送前运行 `python3 scripts/check-privacy.py --history`，同时执行项目测试和语法检查。
- 禁止使用 `--no-verify`、禁用隐私 hooks、绕过 GitHub 的 privacy 检查。后续修改通过 PR 合并，等待隐私检查通过。
- 发布 ZIP 只能包含 `extension` 目录中的发行文件；禁止包含 `.git`、本地配置、依赖目录或备份。发布前扫描 ZIP 内容。
- 若检查阻断，先清理内容和身份后再提交。历史重写、强制推送和公开历史移除须经用户明确授权。
