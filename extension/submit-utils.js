;(function (global) {
  'use strict'
  function normalizeLink(raw, magnetOnly = false) {
    if (typeof raw !== 'string' || raw.length > 16384) throw new Error('离线链接无效')
    const link = raw.trim()
    if (/^magnet:\?/i.test(link)) {
      const url = new URL(link)
      const xt = url.searchParams.getAll('xt')
      if (xt.length !== 1 || !/^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt[0])) throw new Error('磁力哈希无效')
      const key = xt[0].toLowerCase()
      url.searchParams.delete('xt')
      const extra = url.searchParams.toString()
      return { link: `magnet:?xt=${key}${extra ? '&' + extra : ''}`, key }
    }
    if (!magnetOnly && /^ed2k:\/\/\|file\|[^|\r\n]+\|\d+\|[a-f0-9]{32}\|\/?$/i.test(link)) {
      return { link, key: link.split('|')[4].toLowerCase() }
    }
    throw new Error('只支持有效的 magnet/ed2k 离线链接')
  }
  function isTorBoxSender(sender) {
    try {
      const url = new URL(sender.url)
      return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && url.protocol === 'https:' &&
        ['torbox.app', 'www.torbox.app'].includes(url.hostname) && /^\/dashboard(?:\/|$)/.test(url.pathname)
    } catch (_) { return false }
  }
  const api = { normalizeLink, isTorBoxSender }
  global.Push115SubmitUtils = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof self !== 'undefined' ? self : globalThis)
