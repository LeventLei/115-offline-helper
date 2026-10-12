# 首次安装更新助手（macOS Chrome）

1. **不卸载旧扩展**，将1.3.0扩展包解压后覆盖原扩展目录，在Chrome扩展管理页点击重新加载。
2. 将本助手包解压到本机，运行 `sh Install.command`。按提示输入原目录和扩展详情页ID；目录可拖入终端。
3. 打开插件「设置」→「检查更新」。此后新版本可通过「更新并重新加载」安装，设置及扩展ID保留。

若失败提示新增权限，请按版本说明手动确认并原位覆盖安装；无需删除扩展。更新时有提交或后处理任务则暂缓操作。

恢复上一版：打开用户 Application Support 中 Levent115Updater 文件夹的 `Restore.command`，然后在Chrome扩展管理页重新加载插件。该文件夹由安装器创建，备份仅含扩展发行文件。

助手只允许登记ID调用，只访问指定GitHub仓库正式版本，仅写登记目录和私有备份。拒绝任意地址、路径、系统命令、非法ZIP和新增权限；不读取Cookie或Chrome存储，不自动安装更新。

本机登记信息不包含在发行包或仓库中。助手自身不自动更新；未来如协议发生变化，将另行提示更新助手。

## 目录输入格式

Chrome详情页可能将 `Library` 显示为「资源库」。安装器支持 `~/资源库/`、实际的 `~/Library/`、带引号的路径，以及Finder拖入终端生成的反斜杠转义路径。输入必须是包含 `manifest.json` 的一个目录；不会执行路径中的shell命令。

## macOS文件访问权限排查

若提示「macOS拒绝访问助手或扩展文件」，不要卸载扩展或重复安装。Chrome配置目录内的未打包扩展可能受到macOS文件访问保护；终端校验通过，不代表Chrome启动的助手也能读取。

1. 先用 ⌘Q 完全退出Chrome，重新打开并检查更新。
2. 若仍失败，核对安装器生成的 `~/Library/Application Support/Levent115Updater/native-host.command`。其中 `exec` 后的第一个路径是助手实际使用的Python，不一定是终端默认的 `python3`。
3. 在终端运行下面的只读命令，显示该Python的实际执行路径（不读取浏览器数据）：

```sh
python3 - <<'PYTHON'
from pathlib import Path
import shlex
launcher = Path.home() / 'Library/Application Support/Levent115Updater/native-host.command'
line = next(line for line in launcher.read_text().splitlines() if line.startswith('exec '))
print(Path(shlex.split(line)[1]).resolve())
PYTHON
```

4. 若决定授予权限，在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」点 `＋`，按 ⌘⇧G，输入上一步的实际路径，添加并开启。完全退出Chrome后重新检查更新。

完全磁盘访问权限范围较广，也会作用于该Python执行的其他脚本；仅在确认权限拒绝时按需使用，不要求所有用户默认开启。无效时撤回测试权限。已验证案例中，仅给Chrome授权仍失败，给助手实际使用的Python授权后恢复正常。其他机器仍需根据实际结果判断。

Homebrew升级Python后实际执行路径可能变化，需重新核对启动器与授权条目。不要照抄某个固定版本的Cellar路径。若此前仅为测试给Chrome授权，可在助手恢复正常后关闭该测试权限并再次验证。
