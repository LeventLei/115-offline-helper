// 设置页更新状态；只在用户打开页面或点击按钮时检查。
(() => {
  'use strict'
  let lastResult = null
  let checked = false
  let busy = false
  let lastStatus = null
  const text = {
    'zh-CN': { title: '插件更新', current: '当前版本', latest: '最新版本', check: '检查更新', install: '更新并重新加载', reload: '重新加载已更新版本', checking: '正在检查…', installing: '正在下载并校验，请等待…', newest: '当前已是最新版本', available: '发现新版本，点击按钮原位更新，设置会保留', done: '文件已更新，正在重新加载…', id: '复制扩展ID', copied: '扩展ID已复制', helper: '首次下载更新助手', hint: '首次需安装一次本地助手；不卸载插件，不清除设置。', copyFailed: '复制失败，请从扩展详情页复制ID' },
    'en-US': { title: 'Extension updates', current: 'Current', latest: 'Latest', check: 'Check updates', install: 'Update and reload', reload: 'Reload installed update', checking: 'Checking…', installing: 'Downloading and verifying…', newest: 'Up to date', available: 'An update is available. Settings will be retained.', done: 'Installed. Reloading…', id: 'Copy extension ID', copied: 'Extension ID copied', helper: 'Download local updater', hint: 'Install the helper once. Do not uninstall the extension.', copyFailed: 'Copy failed. Copy the ID from the extension details page.' },
  }
  const errors = {
    HELPER_UNAVAILABLE: ["更新助手未安装、未响应或登记不匹配，请先完成助手安装", "The updater helper is missing, unresponsive, or registered incorrectly. Complete the helper setup."],
    FORBIDDEN: ["更新操作的扩展来源不匹配，请从插件弹窗重试", "The update source does not match. Retry from the extension popup."],
    INVALID_MESSAGE: ["更新请求格式无效或包含不支持的参数", "The update request is invalid or contains unsupported parameters."],
    BUSY: ["正在更新，请稍后重试", "An update is running. Try again later."],
    TASKS_BUSY: ["提交或后处理任务正在运行，请完成后再更新", "Submission or post-processing is running. Finish those tasks before updating."],
    INVALID_ACTION: ["不支持此更新操作", "This update action is not supported."],
    FAILED: ["更新失败，请检查助手安装或稍后重试", "Update failed. Check the helper setup or try again later."],
    INVALID_VERSION: ["发行版本格式无效", "The release version format is invalid."],
    INVALID_URL: ["下载地址不在允许范围内", "The download URL is outside the allowed sources."],
    TOO_LARGE: ["下载文件超过大小限制", "The download exceeds the size limit."],
    NETWORK: ["无法连接GitHub，请稍后重试", "Cannot connect to GitHub. Try again later."],
    IDENTITY_CHANGED: ["版本或扩展标识无效或不一致，已取消更新", "The version or extension identity is invalid or does not match. Update cancelled."],
    PERMISSION_DENIED: ["macOS拒绝访问助手或扩展文件，请查看安装说明中的文件访问权限排查；无需重复安装或卸载扩展", "macOS denied access to helper or extension files. See file access troubleshooting in the setup guide; reinstalling or uninstalling the extension is unnecessary."],
    INVALID_TARGET: ["助手登记的扩展目录无效", "The registered extension directory is invalid."],
    NO_RELEASE: ["未找到可用正式版本", "No stable release is available."],
    NO_ASSET: ["正式版本缺少唯一的扩展安装包", "The release does not contain exactly one extension package."],
    NO_DIGEST: ["发行包缺少SHA256摘要，无法更新", "The release package has no SHA256 digest. Cannot update."],
    INVALID_RELEASE: ["GitHub发行数据无法解析", "The GitHub release data could not be parsed."],
    PERMISSION_CHANGED: ["新版增加了权限，需要手动确认后原位安装", "The new version adds permissions. Review them and install in place manually."],
    INVALID_ZIP: ["安装包内容不完整或包含非法文件", "The package is incomplete or contains invalid files."],
    NOT_CONFIGURED: ["助手尚未安装或登记目录无效", "The helper is not installed or its registered directory is invalid."],
    INVALID_STATE: ["更新状态损坏，请运行助手修复安装", "The update state is damaged. Run the helper to repair the setup."],
    PENDING_RELOAD: ["上次更新尚未确认，请先重新加载插件", "The previous update is not confirmed. Reload the extension first."],
    HASH_MISMATCH: ["下载摘要不匹配，原插件未改动", "The download digest does not match. The existing extension is unchanged."],
    UNMANAGED_FILE: ["原扩展目录含链接或额外文件，请检查并移出后更新", "The extension directory contains links or extra files. Check and move them out before updating."],
    INSTALL_FAILED: ["替换失败，已恢复原插件文件", "Replacement failed. The original extension files were restored."],
    VERSION_MISMATCH: ["插件运行版本与更新状态不一致，请重新加载并确认成功启动", "The running version does not match the update state. Reload and confirm the extension starts successfully."],
    RESTORE_FAILED: ["恢复失败，已保留更新前文件", "Restoration failed. The pre-update files were retained."],
  }
  function words() { return text[document.getElementById('push115-language-select')?.value] || text['zh-CN'] }
  function render() {
    const t = words()
    document.getElementById('updater-title').textContent = t.title
    document.getElementById('updater-current').textContent = `${t.current}：${chrome.runtime.getManifest().version}`
    document.getElementById('updater-latest').textContent = `${t.latest}：${lastResult?.latest_version || '—'}`
    document.getElementById('updater-check').textContent = t.check
    document.getElementById('updater-install').textContent = lastResult?.pending_version ? t.reload : t.install
    document.getElementById('updater-copy-id').textContent = t.id
    document.getElementById('updater-helper-link').textContent = t.helper
    document.getElementById('updater-hint').textContent = t.hint
    document.getElementById('updater-install').hidden = !lastResult?.update_available && !lastResult?.pending_version
    renderStatus()
  }
  function renderStatus() {
    if (!lastStatus) return
    const languageIndex = document.getElementById('push115-language-select')?.value === 'en-US' ? 1 : 0
    document.getElementById('updater-status').textContent = lastStatus.error
      ? (Object.hasOwn(errors, lastStatus.key) ? errors[lastStatus.key] : errors.FAILED)[languageIndex]
      : words()[lastStatus.key]
  }
  function status(key, error = false) { lastStatus = { key, error }; renderStatus() }
  async function run(action) {
    if (busy) return
    busy = true
    document.getElementById('updater-check').disabled = true
    document.getElementById('updater-install').disabled = true
    status(action === 'UPDATER_CHECK' ? 'checking' : 'installing')
    try {
      const response = await chrome.runtime.sendMessage({ action })
      if (!response?.success) { status(response?.code || 'HELPER_UNAVAILABLE', true); return }
      if (action === 'UPDATER_CHECK') {
        lastResult = response.data
        if (lastResult.current_version !== chrome.runtime.getManifest().version) lastResult.pending_version = lastResult.current_version
        render()
        status(lastResult.pending_version ? 'reload' : (lastResult.update_available ? 'available' : 'newest'))
      } else { status(response.data?.installed === false ? 'newest' : 'done') }
    } catch (_) { status('FAILED', true) }
    finally {
      busy = false
      document.getElementById('updater-check').disabled = false
      document.getElementById('updater-install').disabled = false
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    render()
    document.getElementById('updater-check').addEventListener('click', event => { if (event.isTrusted) run('UPDATER_CHECK') })
    document.getElementById('updater-install').addEventListener('click', event => {
      if (event.isTrusted) run(lastResult?.pending_version ? 'UPDATER_RELOAD' : 'UPDATER_INSTALL')
    })
    document.getElementById('updater-copy-id').addEventListener('click', async event => {
      if (!event.isTrusted) return
      try { await navigator.clipboard.writeText(chrome.runtime.id); status('copied') }
      catch (_) { status('copyFailed') }
    })
    document.querySelector('[data-tab="settings"]').addEventListener('click', () => {
      if (!checked) { checked = true; run('UPDATER_CHECK') }
    })
    document.getElementById('push115-language-select').addEventListener('change', render)
    document.addEventListener('push115-locale-change', render)
  })
})()
