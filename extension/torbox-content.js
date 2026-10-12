// TorBox 专用内容脚本，不依赖全站自动识别。
(() => {
  'use strict';

  const BUTTON_CLASS = 'push115-torbox-shortcut';
  const INSTANCE_KEY = '__push115TorboxContent';
  // 再次注入时先停止旧实例，避免多个观察器同时添加按钮。
  window[INSTANCE_KEY]?.destroy();
  document.querySelectorAll(`.${BUTTON_CLASS}, .push115-torbox-slot`).forEach(node => node.remove());
  document.getElementById('push115-torbox-style')?.remove();
  const entries = new Map();
  let busy = false;
  let scheduled = false;
  let frame = 0;

  const style = document.createElement('style');
  style.id = 'push115-torbox-style';
  style.textContent = `
    .push115-torbox-slot { min-width: 0; width: 100%; border-radius: 6px; background: #12141b; }
    .${BUTTON_CLASS} {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; padding: 8px 12px; width: 100%; box-sizing: border-box;
      border: 1px solid #302f2f; border-radius: 6px;
      background: rgba(4,191,138,.1); color: #04bf8a; font: 14px/20px sans-serif;
      cursor: pointer; white-space: nowrap;
    }
    .${BUTTON_CLASS} svg { width: 16px; height: 16px; flex-shrink: 0; }
    .${BUTTON_CLASS}:hover { background: rgba(4,191,138,.2); border-color: #04bf8a; }
    .${BUTTON_CLASS}:focus-visible { outline: 2px solid #79efd0; outline-offset: 2px; }
    .${BUTTON_CLASS}:disabled { opacity: .6; cursor: wait; }
    @media (min-width: 640px) { .${BUTTON_CLASS} .push115-torbox-label { display: none; } }
    #push115-torbox-notice {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; background: #1e2129; color: #fff;
      border: 1px solid #087e62; border-radius: 8px; padding: 12px 18px;
      max-width: calc(100vw - 32px); font: 14px/1.5 sans-serif;
      pointer-events: none;
    }
  `;
  document.head.append(style);

  function notice(message) {
    document.getElementById('push115-torbox-notice')?.remove();
    const element = document.createElement('div');
    element.id = 'push115-torbox-notice';
    element.setAttribute('role', 'status');
    element.textContent = message;
    document.body.append(element);
    setTimeout(() => element.remove(), 4000);
  }

  const CHANNEL = 'push115-torbox-v1';
  const pending = new Map();
  function onCopyResult(event) {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL || data.type !== 'COPY_RESULT') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    clearTimeout(request.timer);
    if (data.success === true && typeof data.link === 'string' && data.link.length <= 16384 && /^magnet:\?xt=urn:btih:/i.test(data.link)) request.resolve(data.link);
    else request.reject(new Error(typeof data.error === 'string' ? data.error.slice(0, 200) : '未获得有效短磁力'));
  }
  window.addEventListener('message', onCopyResult);

  async function copyShortMagnet(event, trigger, wrapper, shortcut) {
    event.preventDefault();
    event.stopPropagation();
    // 自动任务只能由用户亲自点击发起。
    if (!event.isTrusted || busy) return;
    busy = true;
    shortcut.disabled = true;
    shortcut.setAttribute('aria-busy', 'true');
    const requestId = crypto.randomUUID();
    try {
      if (!trigger.isConnected) throw new Error('任务已刷新，请重新点击');
      notice('正在复制短磁力…');
      trigger.dataset.push115CopyId = requestId;
      const link = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('复制超时，请刷新页面确认扩展已更新'));
        }, 2500);
        pending.set(requestId, { resolve, reject, timer });
        window.postMessage({ channel: CHANNEL, type: 'COPY_REQUEST', requestId }, location.origin);
      });
      notice('正在提交到115…');
      const response = await chrome.runtime.sendMessage({ action: 'SUBMIT_OFFLINE_TASK', details: { link } });
      if (!response?.success || response.data?.accepted !== true) throw new Error(response?.error || '115 未接受任务');
      notice(response.data.warning || (response.data.duplicate ? '此任务刚刚已提交到115' : '已提交到115，等待离线下载'));
    } catch (error) {
      notice(error.message || '提交失败，请打开扩展检查115登录状态');
    } finally {
      delete trigger.dataset.push115CopyId;
      busy = false;
      shortcut.disabled = false;
      shortcut.removeAttribute('aria-busy');
    }
  }

  function isMoreButton(button) {
    // 原生 SVG 的 <defs><style> 也会计入 textContent。
    // 只匹配按钮直属的文字 span，既忽略 SVG，也不会误中卡片外层按钮。
    return Array.from(button.children).some(child =>
      child.tagName === 'SPAN' && child.textContent.trim() === 'More'
    );
  }

  function isTorrentActions(actions, trigger) {
    // 当前 TorBox 页面使用这个原生标题区分 Torrent/Web/Usenet。
    if (actions.querySelector('[title="Delete torrent"]')) return true;
    // 兼容删除按钮隐藏的布局：找当前卡片上的 Torrent 类型标签。
    for (let parent = actions.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
      const moreButtons = Array.from(parent.querySelectorAll('button[aria-expanded]'))
        .filter(isMoreButton);
      if (moreButtons.length !== 1 || moreButtons[0] !== trigger) break;
      if (Array.from(parent.querySelectorAll('span')).some(span => span.textContent.trim() === 'Torrent')) return true;
    }
    return false;
  }

  function scan() {
    scheduled = false;
    const active = new Set();
    if (!/^\/dashboard(?:\/|$)/.test(location.pathname)) {
      for (const entry of entries.values()) entry.slot.remove();
      entries.clear();
      return;
    }
    for (const trigger of document.querySelectorAll('button[aria-expanded]')) {
      if (!isMoreButton(trigger)) continue;
      // 用原生双列操作网格确定插入位置，避免猜测固定的父元素层数。
      let actions = trigger.parentElement;
      let grid = null;
      for (let depth = 0; actions && depth < 6; depth++, actions = actions.parentElement) {
        grid = Array.from(actions.children).find(child => child.classList.contains('grid-cols-2'));
        if (grid) break;
      }
      if (!actions || !isTorrentActions(actions, trigger)) continue;
      if (!grid || grid.contains(trigger)) continue;
      active.add(trigger);
      const existing = entries.get(trigger);
      if (existing && existing.slot.parentElement === grid) continue;
      existing?.slot.remove();
      const slot = document.createElement('div');
      slot.className = 'push115-torbox-slot';
      const shortcut = document.createElement('button');
      shortcut.type = 'button';
      shortcut.className = BUTTON_CLASS;
      shortcut.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2"/><path d="M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/></svg><span class="push115-torbox-label">复制并离线</span>';
      shortcut.title = '复制短磁力并提交到 115 当前保存目录';
      shortcut.setAttribute('aria-label', '复制并提交此任务到115');
      shortcut.addEventListener('click', event => copyShortMagnet(event, trigger, actions, shortcut));
      slot.append(shortcut);
      grid.append(slot);
      entries.set(trigger, { slot, shortcut });
    }
    for (const [trigger, entry] of entries) {
      if (!active.has(trigger)) { entry.slot.remove(); entries.delete(trigger); }
    }
    // 清理旧版残留和非本实例的重复按钮，不改动网站原生控件。
    const valid = new Set(Array.from(entries.values(), entry => entry.shortcut));
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      if (!valid.has(button)) button.remove();
    }
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(scan);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleScan);
  window[INSTANCE_KEY] = {
    destroy() {
      observer.disconnect();
      window.removeEventListener('message', onCopyResult);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('扩展已重新加载'));
      }
      pending.clear();
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', scheduleScan);
      for (const entry of entries.values()) entry.slot.remove();
      entries.clear();
      style.remove();
    }
  };
  scan();
})();
