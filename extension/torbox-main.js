// MAIN world：只在短时间内捕获当前任务的原生复制，不读取剪贴板。
(() => {
  'use strict'
  if (window.__push115TorboxMain) return
  window.__push115TorboxMain = true
  const CHANNEL = 'push115-torbox-v1'
  let active = false
  window.addEventListener('message', event => {
    const data = event.data
    if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL || data.type !== 'COPY_REQUEST') return
    if (typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.requestId) || active) return
    const trigger = Array.from(document.querySelectorAll('[data-push115-copy-id]'))
      .find(node => node.dataset.push115CopyId === data.requestId)
    if (!trigger || !Array.from(trigger.children).some(node => node.tagName === 'SPAN' && node.textContent.trim() === 'More')) return
    let actions = trigger.parentElement
    for (let depth = 0; actions && depth < 6; depth++, actions = actions.parentElement) {
      if (Array.from(actions.children).some(node => node.classList.contains('grid-cols-2'))) break
    }
    if (!actions) return
    active = true
    const clipboard = navigator.clipboard
    const original = clipboard?.writeText
    const descriptor = clipboard && Object.getOwnPropertyDescriptor(clipboard, 'writeText')
    let observer, timer, finished = false, captured = false, opened = false
    const finish = (success, value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      observer?.disconnect()
      if (clipboard?.writeText === wrapped) {
        if (descriptor) Object.defineProperty(clipboard, 'writeText', descriptor)
        else delete clipboard.writeText
      }
      if (opened && trigger.getAttribute('aria-expanded') === 'true') trigger.click()
      active = false
      window.postMessage({ channel: CHANNEL, type: 'COPY_RESULT', requestId: data.requestId,
        success, ...(success ? { link: value } : { error: value }) }, location.origin)
    }
    const wrapped = function (text) {
      // 不拦截其他剪贴板内容；仍调用浏览器原始方法。
      let promise
      try { promise = Promise.resolve(original.call(clipboard, text)) } catch (error) { promise = Promise.reject(error) }
      if (!captured && typeof text === 'string' && /^magnet:\?xt=urn:btih:/i.test(text)) {
        captured = true
        promise.then(() => finish(true, text), () => finish(false, '复制失败：请允许 TorBox 写入剪贴板'))
        // 原生 TorBox 未处理拒绝时也避免产生额外未处理错误。
        return promise.catch(() => undefined)
      }
      return promise
    }
    const clickCopy = () => {
      const button = Array.from(actions.querySelectorAll('button')).find(node => node.textContent.trim() === 'Copy Short Magnet' && !node.disabled)
      if (!button) return false
      observer?.disconnect()
      button.click()
      return true
    }
    try {
      if (typeof original !== 'function') throw new Error('浏览器无法使用剪贴板')
      Object.defineProperty(clipboard, 'writeText', { configurable: true, writable: true, value: wrapped })
      timer = setTimeout(() => finish(false, '未捕获到短磁力，请检查 Copy Short Magnet 菜单'), 2000)
      observer = new MutationObserver(clickCopy)
      observer.observe(actions, { childList: true, subtree: true })
      if (!clickCopy()) {
        if (trigger.getAttribute('aria-expanded') !== 'true') { opened = true; trigger.click() }
        clickCopy()
      }
    } catch (error) { finish(false, error.message || '无法调用原生复制') }
  })
})()
