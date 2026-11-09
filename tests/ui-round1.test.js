const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const read = file => fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8')

async function popupFixture(config = {}, updaterResponse = { success: false, code: 'HELPER_UNAVAILABLE', error: 'private response detail' }) {
  const dom = new JSDOM(read('popup.html'), { runScripts: 'outside-only', url: 'https://mock.invalid/' })
  const { window } = dom
  await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  const writes = [], calls = [], handlers = {}
  window.matchMedia = () => ({ matches: false })
  window.setTimeout = () => 0
  window.chrome = {
    storage: { local: { get: async () => config, set: value => writes.push(value) } },
    runtime: { getManifest: () => ({ version: '1.3.1' }), sendMessage: (message, callback) => {
      calls.push(message)
      if (callback) callback({ success: true, data: { state: true } })
      else return Promise.resolve(updaterResponse)
    } },
  }
  for (const file of ['path-utils.js', 'offline-utils.js', 'popup.js']) window.eval(read(file))
  await window.eval('init()')
  window.document.removeEventListener('DOMContentLoaded', window.init)
  for (const id of ['updater-check', 'updater-install', 'updater-copy-id']) {
    window.document.getElementById(id).addEventListener = (type, handler) => { handlers[id] = handler }
  }
  window.eval(read('updater-ui.js'))
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  await new Promise(resolve => setImmediate(resolve))
  return { dom, window, document: window.document, writes, calls, handlers }
}

function change(f, id, value) {
  const element = f.document.getElementById(id)
  if (element.type === 'checkbox') element.checked = value
  else element.value = value
  element.dispatchEvent(new f.window.Event('change'))
}

test('主页按输入、目录、主操作排列，辅助入口和原生折叠配置完整', async () => {
  const f = await popupFixture({ push115_auto_delete_small: true, push115_delete_size_threshold: 88 })
  const home = f.document.getElementById('push115-tab-home')
  assert.deepEqual([...home.querySelectorAll('textarea, select, button')].slice(0, 5).map(el => el.id), [
    'push115-links-input', 'push115-save-dir-select', 'push115-batch-push', 'push115-check-login', 'push115-login-btn',
  ])
  assert.equal(home.querySelectorAll('.push115-btn-primary').length, 1)
  const details = home.querySelector('details')
  assert.equal(details.open, false)
  assert.equal(details.firstElementChild.tagName, 'SUMMARY')
  for (const id of ['push115-auto-delete', 'push115-auto-clean-names', 'push115-auto-organize', 'push115-auto-delete-empty-folders']) {
    assert.ok(details.contains(f.document.getElementById(id)))
  }
  assert.equal(f.document.getElementById('push115-auto-delete').checked, true)
  assert.equal(f.document.getElementById('push115-delete-size').value, '88')
  assert.equal(f.document.getElementById('push115-delete-section').style.display, 'block')
  change(f, 'push115-auto-delete', false)
  assert.equal(f.document.getElementById('push115-delete-section').style.display, 'none')
  assert.equal(f.writes.at(-1).push115_auto_delete_small, false)
  assert.equal(f.document.getElementById('label-batch-links').control.id, 'push115-links-input')
  assert.equal(f.document.getElementById('label-save-path').control.id, 'push115-save-dir-select')
  f.dom.window.close()
})

test('主题语言往返切换即时本地化，保留开关和已有主页交互', async () => {
  const f = await popupFixture()
  change(f, 'push115-language-select', 'en-US')
  assert.equal(f.document.documentElement.lang, 'en-US')
  assert.equal(f.document.getElementById('label-language').textContent, 'Language')
  assert.equal(f.document.getElementById('label-theme').textContent, 'Theme')
  assert.deepEqual([...f.document.getElementById('push115-theme-select').options].map(el => el.textContent), ['System', 'Light', 'Dark'])
  assert.equal(f.document.querySelector('summary').textContent, 'After-task processing')
  change(f, 'push115-theme-select', 'dark')
  assert.ok(f.document.body.classList.contains('dark-theme'))
  change(f, 'push115-theme-select', 'light')
  assert.ok(!f.document.body.classList.contains('dark-theme'))
  change(f, 'push115-auto-clean-names', true)
  change(f, 'push115-language-select', 'zh-CN')
  assert.equal(f.document.querySelector('summary').textContent, '任务后自动处理')
  assert.deepEqual([...f.document.getElementById('push115-theme-select').options].map(el => el.textContent), ['跟随系统', '浅色', '深色'])
  assert.equal(f.document.getElementById('push115-auto-clean-names').checked, true)
  f.document.getElementById('push115-check-login').click()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(f.document.getElementById('push115-status-area').textContent, /已登录/)
  f.document.getElementById('push115-login-btn').click()
  assert.notEqual(f.document.getElementById('push115-login-modal').style.display, 'none')
  f.document.getElementById('push115-links-input').value = 'not a link'
  f.document.getElementById('push115-batch-push').click()
  assert.match(f.document.getElementById('push115-status-area').textContent, /没有识别/)
  assert.equal(f.calls.some(call => call.action === 'SUBMIT_OFFLINE_TASK'), false)
  f.dom.window.close()
})

test('更新错误按错误码双语显示，切换语言重绘现有状态且不显示响应详情', async () => {
  for (const code of ['HELPER_UNAVAILABLE', 'TASKS_BUSY', 'PERMISSION_DENIED', 'HASH_MISMATCH', 'UNKNOWN']) {
    const f = await popupFixture({}, { success: false, code, error: 'private response detail' })
    await f.handlers['updater-check']({ isTrusted: false })
    assert.equal(f.calls.length, 0)
    await f.handlers['updater-check']({ isTrusted: true })
    await new Promise(resolve => setImmediate(resolve))
    const status = f.document.getElementById('updater-status')
    assert.ok(status.textContent)
    assert.ok(!status.textContent.includes('private response'))
    change(f, 'push115-language-select', 'en-US')
    assert.doesNotMatch(status.textContent, /[\u4e00-\u9fff]/)
    assert.equal(f.document.getElementById('updater-check').disabled, false)
    if (code === 'TASKS_BUSY') assert.match(status.textContent, /post-processing/)
    if (code === 'HASH_MISMATCH') assert.match(status.textContent, /unchanged/)
    change(f, 'push115-language-select', 'zh-CN')
    assert.match(status.textContent, /[\u4e00-\u9fff]/)
    f.dom.window.close()
  }
})

test('普通与持续通知共存，更新变长、替换及到期移除互不干扰', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' })
  const { window } = dom
  const timers = []
  window.setTimeout = (fn, ms) => { timers.push({ fn, ms }) }
  const source = read('content.js')
  window.eval(source.slice(source.indexOf("let injectedStylesText = ''"), source.indexOf('let activeModalHost = null')))
  window.eval("injectModalStyles(); showToast('success', 'done', 3000); showStickyToast('info', 'working')")
  const stack = window.document.getElementById('push115-toast-stack')
  assert.equal(stack.children.length, 2)
  const sticky = stack.querySelector('.push115-sticky')
  const longMessage = 'long status '.repeat(60)
  window.eval(`showStickyToast('warning', ${JSON.stringify(longMessage)}, false)`)
  assert.equal(stack.querySelector('.push115-sticky'), sticky)
  assert.equal(sticky.textContent, longMessage)
  assert.equal(sticky.querySelector('.push115-toast-spinner'), null)
  window.eval("showToast('info', 'next', 5000)")
  assert.equal(stack.children.length, 2)
  assert.ok(sticky.isConnected)
  timers[0].fn()
  assert.equal(stack.children.length, 2)
  timers[1].fn()
  assert.equal(stack.children.length, 1)
  assert.equal(stack.firstElementChild, sticky)
  window.eval('hideStickyToast(); hideStickyToast()')
  assert.equal(stack.children.length, 0)
  window.eval("showStickyToast('info', 'again'); showToast('success', 'persistent', 0); hideStickyToast()")
  assert.equal(stack.children.length, 1)
  assert.equal(stack.textContent, 'persistent')
  const style = window.document.querySelector('style').textContent
  assert.match(style, /flex-direction: column/)
  assert.match(style, /overflow-wrap: anywhere/)
  assert.match(style, /max-width: calc\(100vw - 32px\)/)
  assert.match(style, /:empty \{ display: none/)
  dom.window.close()
})


test('保存的英文语言在异步初始化完成后同步更新组件', async () => {
  const f = await popupFixture({ push115_i18n_locale: 'en-US', push115_theme: 'dark' })
  assert.equal(f.document.getElementById('updater-title').textContent, 'Extension updates')
  assert.equal(f.document.getElementById('push115-language-select').value, 'en-US')
  assert.ok(f.document.body.classList.contains('dark-theme'))
  f.dom.window.close()
})

test('主页批量提交仍会去重，完成后恢复主按钮并保留目录交互', async () => {
  const f = await popupFixture({ push115_save_path_list: 'Mock:123456789' })
  const link = 'magnet:?xt=urn:btih:' + 'a'.repeat(40)
  f.document.getElementById('push115-links-input').value = `${link}\n${link}`
  f.document.getElementById('push115-batch-push').click()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.filter(call => call.action === 'SUBMIT_OFFLINE_TASK').length, 1)
  assert.equal(f.document.getElementById('push115-batch-push').disabled, false)
  assert.equal(f.document.getElementById('push115-batch-push').textContent, '识别并推送')
  change(f, 'push115-save-dir-select', '123456789')
  assert.ok(f.writes.some(value => value.push115_save_path_cid === '123456789'))
  assert.equal(f.document.querySelector('.push115-path-select-wrapper').dataset.selectedLabel, 'Mock')
  f.dom.window.close()
})

test('更新成功、无更新及待重载状态维持原操作并支持语言切换', async () => {
  for (const state of ['latest', 'available', 'reload']) {
    const f = await popupFixture({}, { success: true, data: { current_version: state === 'reload' ? '1.3.2' : '1.3.1', update_available: state === 'available' } })
    f.handlers['updater-check']({ isTrusted: true })
    f.handlers['updater-check']({ isTrusted: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls.length, 1)
    change(f, 'push115-language-select', 'en-US')
    const status = f.document.getElementById('updater-status').textContent
    assert.match(status, state === 'latest' ? /Up to date/ : state === 'available' ? /available/ : /Reload/)
    assert.equal(f.document.getElementById('updater-install').hidden, state === 'latest')
    if (state !== 'latest') {
      f.handlers['updater-install']({ isTrusted: true })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(f.calls.at(-1).action, state === 'reload' ? 'UPDATER_RELOAD' : 'UPDATER_INSTALL')
      assert.match(f.document.getElementById('updater-status').textContent, /Installed/)
    }
    f.dom.window.close()
  }
})

test('更新调用异常及复制失败使用可切换语言的固定提示', async () => {
  const f = await popupFixture()
  f.window.chrome.runtime.sendMessage = () => Promise.reject(new Error('private response detail'))
  f.handlers['updater-check']({ isTrusted: true })
  await new Promise(resolve => setImmediate(resolve))
  change(f, 'push115-language-select', 'en-US')
  assert.match(f.document.getElementById('updater-status').textContent, /^Update failed/)
  assert.equal(f.document.getElementById('updater-check').disabled, false)
  await f.handlers['updater-copy-id']({ isTrusted: true })
  assert.match(f.document.getElementById('updater-status').textContent, /^Copy failed/)
  change(f, 'push115-language-select', 'zh-CN')
  assert.match(f.document.getElementById('updater-status').textContent, /^复制失败/)
  f.dom.window.close()
})

test('弹窗body宽度不依赖视口单位，避免Chrome弹窗被压窄', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../extension/popup.css'), 'utf8')
  const body = css.match(/\nbody \{[^}]*\}/)[0]
  assert.match(body, /width: 440px/)
  assert.doesNotMatch(body, /vw|vh/)
})
