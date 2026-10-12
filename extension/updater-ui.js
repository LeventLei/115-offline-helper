// 设置页更新状态；只在用户打开页面或点击按钮时检查。
(() => {
  'use strict'
  let lastResult = null
  let checked = false
  let busy = false
  const text = {
    'zh-CN': { title: '插件更新', current: '当前版本', latest: '最新版本', check: '检查更新', install: '更新并重新加载', reload: '重新加载已更新版本', checking: '正在检查…', installing: '正在下载并校验，请等待…', newest: '当前已是最新版本', available: '发现新版本，点击按钮原位更新，设置会保留', done: '文件已更新，正在重新加载…', id: '复制扩展ID', copied: '扩展ID已复制', helper: '首次下载更新助手', hint: '首次需安装一次本地助手；不卸载插件，不清除设置。' },
    'en-US': { title: 'Extension updates', current: 'Current', latest: 'Latest', check: 'Check updates', install: 'Update and reload', reload: 'Reload installed update', checking: 'Checking…', installing: 'Downloading and verifying…', newest: 'Up to date', available: 'An update is available. Settings will be retained.', done: 'Installed. Reloading…', id: 'Copy extension ID', copied: 'Extension ID copied', helper: 'Download local updater', hint: 'Install the helper once. Do not uninstall the extension.' },
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
  }
  function status(message) { document.getElementById('updater-status').textContent = message }
  async function run(action) {
    if (busy) return
    busy = true
    document.getElementById('updater-check').disabled = true
    document.getElementById('updater-install').disabled = true
    status(action === 'UPDATER_CHECK' ? words().checking : words().installing)
    try {
      const response = await chrome.runtime.sendMessage({ action })
      if (!response?.success) throw new Error(response?.error || '无法连接更新助手')
      if (action === 'UPDATER_CHECK') {
        lastResult = response.data
        if (lastResult.current_version !== chrome.runtime.getManifest().version) lastResult.pending_version = lastResult.current_version
        render()
        status(lastResult.pending_version ? words().reload : (lastResult.update_available ? words().available : words().newest))
      } else { status(response.data?.installed === false ? words().newest : words().done) }
    } catch (error) { status(error.message || '更新失败，请检查助手安装') }
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
      try { await navigator.clipboard.writeText(chrome.runtime.id); status(words().copied) }
      catch (_) { status('复制失败，请从扩展详情页复制ID') }
    })
    document.querySelector('[data-tab="settings"]').addEventListener('click', () => {
      if (!checked) { checked = true; run('UPDATER_CHECK') }
    })
    document.getElementById('push115-language-select').addEventListener('change', render)
  })
})()
