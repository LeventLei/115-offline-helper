// 原生更新入口仅供扩展弹窗使用；不接受网页提供的路径、地址或命令。
;(function (global) {
  'use strict'
  const HOST = 'com.leventlei.push115_updater'
  function create({ runtime, isPopupSender, getBusy, schedule = setTimeout }) {
    let installing = false
    async function native(action, extra = {}) {
      let timer
      try {
        const response = await Promise.race([
          runtime.sendNativeMessage(HOST, { protocol: 1, action, ...extra }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 120000) }),
        ])
        if (!response || typeof response.success !== 'boolean') throw new Error('invalid')
        return response
      } catch (_) {
        return { success: false, code: 'HELPER_UNAVAILABLE', error: '更新助手未安装、未响应或登记不匹配，请先完成助手安装' }
      } finally { clearTimeout(timer) }
    }
    async function handle(request, sender) {
      if (!sender || sender.id !== runtime.id || !isPopupSender(sender)) {
        return { success: false, code: 'FORBIDDEN', error: '仅插件弹窗可以操作更新' }
      }
      if (Object.keys(request).some(key => key !== 'action')) {
        return { success: false, code: 'INVALID_MESSAGE', error: '更新请求包含不支持的参数' }
      }
      if (installing) return { success: false, code: 'BUSY', error: '正在更新，请稍后重试' }
      if (request.action === 'UPDATER_CHECK') return native('check')
      if (request.action === 'UPDATER_STATUS') return native('status')
      if (!['UPDATER_INSTALL', 'UPDATER_RELOAD'].includes(request.action)) return { success: false, code: 'INVALID_ACTION', error: '不支持此更新操作' }
      installing = true
      let reloading = false
      try {
        if (await getBusy()) return { success: false, code: 'TASKS_BUSY', error: '提交或后处理任务正在运行，请完成后再更新' }
        const response = await native(request.action === 'UPDATER_INSTALL' ? 'install' : 'status')
        if (response.success && (response.data?.installed === true || request.action === 'UPDATER_RELOAD')) {
          reloading = true
          schedule(() => { try { runtime.reload() } catch (_) { installing = false } }, 300)
        }
        return response
      } catch (_) { return { success: false, code: 'FAILED', error: '无法检查更新条件，请稍后重试' } }
      finally { if (!reloading) installing = false }
    }
    async function confirmStartup() {
      // 只确认已写入版本的启动，不查询网络、不自动安装。
      return native('confirm', { version: runtime.getManifest().version })
    }
    return { handle, confirmStartup, isInstalling: () => installing }
  }
  global.Push115Updater = { create }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create }
})(typeof self !== 'undefined' ? self : globalThis)
