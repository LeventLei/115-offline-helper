// Background Service Worker

importScripts('offline-utils.js', 'security-utils.js', 'submit-utils.js', 'updater-bridge.js')

let updaterBridge = null;
let activeApiRequests = 0;

const STORAGE_KEYS = {
  AUTO_DETECT: 'push115_auto_detect',
};

const CONTENT_SCRIPT_ID = 'push115-content-script';
const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];
const TASK_MONITOR_STORAGE_KEY = 'push115_task_monitors';
const TASK_MONITOR_ALARM_PREFIX = 'push115-task-monitor:';
const TASK_MONITOR_MAX_ATTEMPTS = 40;

// ========== Dynamic Content Script Registration ==========

async function registerContentScripts() {
  try {
    // Unregister first to avoid duplicates
    await unregisterContentScripts();
    await chrome.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['path-utils.js', 'offline-utils.js', 'content.js'],
      runAt: 'document_idle',
    }]);
    console.log('[BG] Content scripts registered');
  } catch (e) {
    console.error('[BG] Failed to register content scripts:', e);
  }
}

// Inject content scripts into all existing open tabs (registerContentScripts only affects future loads)
async function injectIntoExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['path-utils.js', 'offline-utils.js', 'content.js'],
        });
      } catch (e) {
        // Ignore tabs we can't inject into (e.g., chrome:// pages)
      }
    }
    console.log(`[BG] Injected content scripts into ${tabs.length} existing tabs`);
  } catch (e) {
    console.error('[BG] Failed to inject into existing tabs:', e);
  }
}

async function unregisterContentScripts() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    console.log('[BG] Content scripts unregistered');
  } catch (e) {
    // Ignore error if not registered
  }
}

async function syncContentScriptState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.AUTO_DETECT);
  const autoDetect = data[STORAGE_KEYS.AUTO_DETECT] === true;
  if (autoDetect) {
    // Verify we still have the permission
    const hasPermission = await chrome.permissions.contains({ origins: PAGE_ORIGINS });
    if (hasPermission) {
      await registerContentScripts();
    } else {
      // Permission was revoked, disable auto-detect
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_DETECT]: false });
      await unregisterContentScripts();
    }
  } else {
    await unregisterContentScripts();
  }
}

// On install or startup, sync state
chrome.runtime.onInstalled.addListener(() => {
  syncContentScriptState();
});

chrome.runtime.onStartup.addListener(() => {
  syncContentScriptState();
});

// Watch for auto-detect setting changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.AUTO_DETECT]) {
    syncContentScriptState();
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm?.name?.startsWith(TASK_MONITOR_ALARM_PREFIX)) {
    handleTaskMonitorAlarm(alarm.name);
  }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: '拒绝未知扩展来源' });
    return false;
  }

  if (typeof request?.action === 'string' && request.action.startsWith('UPDATER_')) {
    if (!updaterBridge) { sendResponse({ success: false, error: '更新组件不可用，请重新加载' }); return false; }
    updaterBridge.handle(request, sender).then(sendResponse);
    return true;
  }
  if (updaterBridge?.isInstalling() && ['SUBMIT_OFFLINE_TASK', 'API_REQUEST', 'START_TASK_MONITOR'].includes(request.action)) {
    sendResponse({ success: false, error: '更新进行中，请稍后再提交或处理任务' });
    return false;
  }

  if (request.action === 'SUBMIT_OFFLINE_TASK') {
    if (!isExtensionPageSender(sender) && !Push115SubmitUtils.isTorBoxSender(sender)) {
      sendResponse({ success: false, error: '拒绝非 TorBox 顶层页面来源' });
      return false;
    }
    submitOfflineTask(request.details, !isExtensionPageSender(sender))
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'API_REQUEST') {
    handleApiRequest(request, sendResponse);
    return true; // Keep the message channel open for async response
  } else if (request.action === 'REGISTER_CONTENT_SCRIPTS') {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ success: false, error: '仅扩展页面可以修改全站注入设置' });
      return false;
    }
    registerContentScripts()
      .then(() => injectIntoExistingTabs())
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.action === 'UNREGISTER_CONTENT_SCRIPTS') {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ success: false, error: '仅扩展页面可以修改全站注入设置' });
      return false;
    }
    Promise.all([
      unregisterContentScripts(),
      chrome.permissions.remove({ origins: PAGE_ORIGINS }),
    ]).then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (request.action === 'START_TASK_MONITOR') {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ success: false, error: '仅扩展弹窗可以启动任务处理监控' });
      return false;
    }
    startTaskMonitor(request.details)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

function isExtensionPageSender(sender) {
  const extensionRoot = chrome.runtime.getURL('');
  return typeof sender?.url === 'string' && sender.url.startsWith(extensionRoot);
}

const AUTH_COOKIE_NAMES = ['UID', 'CID', 'SEID'];
const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_COOKIE_MISSING = '登录响应缺少完整认证信息，请重新扫码';
const LOGIN_COOKIE_WRITE_FAILED = '认证 Cookie 写入失败，请检查扩展权限后重新扫码';
const LOGIN_FAILED = '登录失败，请重新扫码或检查扩展权限';

async function syncCookieStringToJar(cookieString) {
  const pairs = Push115SecurityUtils.parseAuthCookie(cookieString)
    .split(';').map(item => item.trim()).filter(Boolean)
    .map(pair => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1) };
    });
  // 全部字段检查通过后才写入，避免不完整响应被误报为成功。
  if (pairs.length !== AUTH_COOKIE_NAMES.length ||
      !AUTH_COOKIE_NAMES.every(name => pairs.filter(pair => pair.name === name && pair.value).length === 1)) {
    throw new Error(LOGIN_COOKIE_MISSING);
  }
  const now = Date.now() / 1000;
  const maximumExpiry = now + AUTH_COOKIE_MAX_AGE_SECONDS;
  for (const { name, value } of pairs) {
    try {
      const existing = await chrome.cookies.get({ url: 'https://115.com/', name });
      // 同值、未过期的持久 Cookie 不延长原期限；新值不继承旧授权期限。
      const preserveExpiry = existing?.value === value && existing.session !== true &&
        Number.isFinite(existing.expirationDate) && existing.expirationDate > now;
      const expirationDate = preserveExpiry
        ? Math.min(existing.expirationDate, maximumExpiry) : maximumExpiry;
      const written = await chrome.cookies.set({
        url: 'https://115.com/', name, value, domain: '.115.com', path: '/',
        secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate,
      });
      if (!written || written.name !== name || written.value !== value || written.session === true ||
          !Number.isFinite(written.expirationDate) || written.expirationDate <= now ||
          written.expirationDate > expirationDate + 1) {
        throw new Error(LOGIN_COOKIE_WRITE_FAILED);
      }
    } catch (_) {
      // 不记录原始浏览器错误，防止错误文本带出凭据。
      throw new Error(LOGIN_COOKIE_WRITE_FAILED);
    }
  }
  return true;
}

async function persistAuthCookieToJar(rawCookie) {
  await syncCookieStringToJar(rawCookie);
  return true;
}

async function fetch115Json(url, method = 'GET', data = null, allowMissingState = false) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!Push115SecurityUtils.isAllowedApiRequest(url, normalizedMethod)) {
    throw new Error('请求被安全策略拦截');
  }

  const options = { method: normalizedMethod, credentials: 'include' };
  if (normalizedMethod === 'POST' && data) {
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    options.body = new URLSearchParams(data);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (_) {
    throw new Error('115 接口返回了无法解析的响应');
  }
  if (!response.ok || !(result?.state === true || result?.state === 1 || (allowMissingState && result && typeof result === 'object' && result.state === undefined))) {
    throw new Error(result?.error_msg || result?.error || `115 接口请求失败 (${response.status})`);
  }
  return result;
}

function normalizeMonitorCid(value, allowRoot = false) {
  const cid = String(value ?? '').trim();
  return /^\d+$/.test(cid) && (allowRoot || cid !== '0') ? cid : '';
}

async function startTaskMonitor(details = {}) {
  const savePathCid = normalizeMonitorCid(details.savePathCid, true);
  const filterTerms = Push115OfflineUtils.normalizeFilterTerms(details.filterTerms).slice(0, 50);
  const deleteEmptyFolders = details.deleteEmptyFolders === true;
  const taskMeta = details.taskMeta && typeof details.taskMeta === 'object' ? {
    id: String(details.taskMeta.id || '').slice(0, 200),
    name: String(details.taskMeta.name || '').slice(0, 200),
  } : null;

  if (!savePathCid || !taskMeta || (!taskMeta.id && !taskMeta.name) || (filterTerms.length === 0 && !deleteEmptyFolders)) {
    throw new Error('任务监控参数不完整，已跳过自动清理');
  }

  const monitorId = `${TASK_MONITOR_ALARM_PREFIX}${crypto.randomUUID()}`;
  const stored = await chrome.storage.session.get(TASK_MONITOR_STORAGE_KEY);
  const monitors = stored[TASK_MONITOR_STORAGE_KEY] || {};
  monitors[monitorId] = {
    taskMeta,
    savePathCid,
    filterTerms,
    deleteEmptyFolders,
    attempts: 0,
    running: false,
  };
  await chrome.storage.session.set({ [TASK_MONITOR_STORAGE_KEY]: monitors });
  await chrome.alarms.create(monitorId, { periodInMinutes: 0.5 });
  return { monitorId };
}

async function removeTaskMonitor(monitorId) {
  const stored = await chrome.storage.session.get(TASK_MONITOR_STORAGE_KEY);
  const monitors = stored[TASK_MONITOR_STORAGE_KEY] || {};
  delete monitors[monitorId];
  await chrome.storage.session.set({ [TASK_MONITOR_STORAGE_KEY]: monitors });
  await chrome.alarms.clear(monitorId);
}

async function getTaskMonitor(monitorId) {
  const stored = await chrome.storage.session.get(TASK_MONITOR_STORAGE_KEY);
  return stored[TASK_MONITOR_STORAGE_KEY]?.[monitorId] || null;
}

async function updateTaskMonitor(monitorId, monitor) {
  const stored = await chrome.storage.session.get(TASK_MONITOR_STORAGE_KEY);
  const monitors = stored[TASK_MONITOR_STORAGE_KEY] || {};
  if (monitors[monitorId]) monitors[monitorId] = monitor;
  await chrome.storage.session.set({ [TASK_MONITOR_STORAGE_KEY]: monitors });
}

async function resolveTaskFolderForMonitor(task, savePathCid) {
  const directCid = normalizeMonitorCid(task?.file_id || task?.fileId || task?.dir_id || task?.dirId || task?.wppath_id);
  if (directCid) {
    const direct = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${directCid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=1&snap=0&natsort=1`);
    if (Array.isArray(direct.data)) return directCid;
  }

  const taskName = String(task?.name || '').trim().toLocaleLowerCase();
  if (!taskName) return '';
  const parent = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${savePathCid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=500&snap=0&natsort=1`);
  const folders = Array.isArray(parent.data) ? parent.data.filter(item => !item.sha) : [];
  const normalizeName = item => String(item?.n || item?.name || '').trim().toLocaleLowerCase();
  const exact = folders.find(item => normalizeName(item) === taskName);
  const fuzzy = exact || folders.find(item => normalizeName(item).includes(taskName));
  return normalizeMonitorCid(fuzzy?.cid || fuzzy?.fid);
}

async function renameTaskFolderForMonitor(taskCid, taskName, savePathCid, filterTerms) {
  const rootCid = normalizeMonitorCid(taskCid);
  if (!rootCid || filterTerms.length === 0) return { renamed: 0, name: String(taskName || '') };

  let currentName = String(taskName || '').trim();
  try {
    const parent = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${savePathCid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=500&snap=0&natsort=1`);
    const match = (Array.isArray(parent.data) ? parent.data : []).find(item =>
      !item.sha && normalizeMonitorCid(item.cid || item.fid) === rootCid,
    );
    if (match) currentName = String(match.n || match.name || currentName).trim();
  } catch (error) {
    console.warn('[任务监控] 读取任务根文件夹名称失败:', error?.message || error);
  }

  if (!currentName || /^(?:magnet:|ed2k:)/i.test(currentName)) return { renamed: 0, name: currentName };
  const nextName = Push115OfflineUtils.sanitizeName(currentName, filterTerms);
  if (nextName === currentName) return { renamed: 0, name: currentName };

  const result = await fetch115Json('https://webapi.115.com/files/edit', 'POST', { fid: rootCid, name: nextName });
  if (result?.state === true || result?.state === 1) return { renamed: 1, name: nextName };
  return { renamed: 0, name: currentName };
}

async function cleanNamesForMonitor(rootCid, filterTerms) {
  const queue = [{ cid: rootCid, depth: 0 }];
  const visited = new Set();
  let scanned = 0;
  let renamed = 0;

  while (queue.length && scanned < 5000) {
    const current = queue.shift();
    if (visited.has(current.cid) || current.depth > 10) continue;
    visited.add(current.cid);

    const items = [];
    for (let offset = 0; offset < 5000 && items.length < 5000; offset += 500) {
      const page = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${current.cid}&o=user_ptime&asc=0&offset=${offset}&show_dir=1&limit=500&snap=0&natsort=1`);
      const pageItems = Array.isArray(page.data) ? page.data : [];
      items.push(...pageItems);
      if (pageItems.length < 500) break;
    }

    for (const item of items) {
      if (scanned >= 5000) break;
      scanned++;
      const id = normalizeMonitorCid(item.fid || item.cid);
      const name = String(item.n || item.name || '');
      if (!item.sha && id && id !== current.cid) queue.push({ cid: id, depth: current.depth + 1 });
      if (!id || !name) continue;
      const nextName = Push115OfflineUtils.sanitizeName(name, filterTerms);
      if (nextName === name) continue;
      const result = await fetch115Json('https://webapi.115.com/files/edit', 'POST', { fid: id, name: nextName });
      if (result?.state === true || result?.state === 1) renamed++;
    }
  }

  return { scanned, renamed, truncated: scanned >= 5000 };
}

async function deleteEmptyFoldersForMonitor(rootCid) {
  const queue = [{ cid: rootCid, depth: 0 }];
  const visited = new Set();
  let scanned = 0;
  let deleted = 0;
  let truncated = false;

  const visit = async (folderCid, depth) => {
    if (!folderCid || visited.has(folderCid) || depth > 10 || scanned >= 5000) {
      if (scanned >= 5000) truncated = true;
      return;
    }
    visited.add(folderCid);

    const page = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${folderCid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=500&snap=0&natsort=1`);
    const items = Array.isArray(page.data) ? page.data : [];
    for (const item of items) {
      if (scanned >= 5000) {
        truncated = true;
        break;
      }
      scanned++;
      if (item.sha) continue;
      const childCid = normalizeMonitorCid(item.cid || item.fid);
      if (childCid && childCid !== folderCid) queue.push({ cid: childCid, depth: depth + 1 });
    }

    while (queue.length && scanned < 5000) {
      const child = queue.shift();
      await visit(child.cid, child.depth);
    }

    if (folderCid === rootCid) return;
    const refreshed = await fetch115Json(`https://webapi.115.com/files?aid=1&cid=${folderCid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=1&snap=0&natsort=1`);
    const refreshedItems = Array.isArray(refreshed.data) ? refreshed.data : [];
    if (!Push115OfflineUtils.isEmptyFolderItems(refreshedItems)) return;

    const result = await fetch115Json('https://webapi.115.com/rb/delete', 'POST', {
      'fid[0]': folderCid,
      ignore_warn: '1',
    });
    if (result?.state === true || result?.state === 1) deleted++;
  };

  await visit(rootCid, 0);
  return { scanned, deleted, truncated };
}

async function handleTaskMonitorAlarm(monitorId) {
  const monitor = await getTaskMonitor(monitorId);
  if (!monitor || monitor.running) return;
  if (monitor.attempts >= TASK_MONITOR_MAX_ATTEMPTS) {
    await removeTaskMonitor(monitorId);
    return;
  }

  monitor.running = true;
  monitor.attempts += 1;
  await updateTaskMonitor(monitorId, monitor);
  try {
    const list = await fetch115Json('https://115.com/web/lixian/?ct=lixian&ac=task_lists');
    const tasks = Array.isArray(list.tasks) ? list.tasks : [];
    const task = tasks.find(item =>
      (monitor.taskMeta.id && [item.info_hash, item.name, item.url, item.source_url].includes(monitor.taskMeta.id)) ||
      (monitor.taskMeta.name && item.name === monitor.taskMeta.name),
    );
    if (!task) {
      monitor.running = false;
      await updateTaskMonitor(monitorId, monitor);
      return;
    }
    if (task.status === -1 || task.state === 2) {
      await removeTaskMonitor(monitorId);
      return;
    }
    const complete = task.status === 2 || task.percentDone === 100 || task.state === 1;
    if (!complete) {
      monitor.running = false;
      await updateTaskMonitor(monitorId, monitor);
      return;
    }

    const targetCid = await resolveTaskFolderForMonitor(task, monitor.savePathCid);
    if (!targetCid) {
      monitor.running = false;
      await updateTaskMonitor(monitorId, monitor);
      return;
    }
    if (monitor.filterTerms.length > 0) {
      await renameTaskFolderForMonitor(targetCid, task.name, monitor.savePathCid, monitor.filterTerms);
      await cleanNamesForMonitor(targetCid, monitor.filterTerms);
    }
    if (monitor.deleteEmptyFolders) await deleteEmptyFoldersForMonitor(targetCid);
    await removeTaskMonitor(monitorId);
  } catch (error) {
    console.warn('[任务监控] 自动清理失败:', error?.message || error);
    monitor.running = false;
    await updateTaskMonitor(monitorId, monitor);
  }
}

// Handle generic API requests using fetch
async function handleApiRequest(request, sendResponse) {
  activeApiRequests += 1;
  let isLoginRequest = false;
  try {
    const { url, method = 'GET', data = null, headers = {} } = request.details || {};
    const normalizedMethod = String(method || 'GET').toUpperCase();
    isLoginRequest = new URL(url).hostname === 'passportapi.115.com';
    if (!Push115SecurityUtils.isAllowedApiRequest(url, normalizedMethod)) {
      throw new Error('请求被安全策略拦截：仅允许预定义的 115 官方接口');
    }

    const requestHeaders = {};
    if (headers['Content-Type'] === 'application/x-www-form-urlencoded') {
      requestHeaders['Content-Type'] = headers['Content-Type'];
    }

    // Convert data to URLSearchParams for POST
    let body = undefined;
    if (normalizedMethod === 'POST' && data) {
      if (typeof data === 'string') {
        body = data;
      } else {
        const params = new URLSearchParams();
        for (const key in data) {
          params.append(key, data[key]);
        }
        body = params;
      }
    }

    const fetchOptions = {
      method: normalizedMethod,
      headers: requestHeaders,
      body,
      credentials: 'include',
    };

    const response = await fetch(url, fetchOptions);
    const responseText = await response.text();

    // Try to parse JSON
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      // Not JSON
    }

    // 扫码登录必须完成三项 Cookie 写入，响应才可标记 cookie_saved。
    let responsePayload = responseJson;
    if (isLoginRequest) {
      if (!response.ok || responseJson?.state !== 1) throw new Error(LOGIN_FAILED);
      await persistAuthCookieToJar(responseJson.data?.cookie);
      responsePayload = Push115SecurityUtils.redactLoginCookie(responseJson);
    }

    sendResponse({
      success: true,
      data: responsePayload || responseText,
      status: response.status,
      statusText: response.statusText
    });
  } catch (error) {
    const safeLoginErrors = [LOGIN_COOKIE_MISSING, LOGIN_COOKIE_WRITE_FAILED, LOGIN_FAILED];
    if (!isLoginRequest) console.error('API Request Error:', error);
    sendResponse({
      success: false,
      error: isLoginRequest
        ? (safeLoginErrors.includes(error.message) ? error.message : LOGIN_FAILED)
        : error.message
    });
  } finally { activeApiRequests -= 1; }
}


// 统一提交入口：目录和后处理配置只从扩展存储读取。
const submissionInflight = new Map();
let submissionCacheQueue = Promise.resolve();
async function submitOfflineTask(details = {}, magnetOnly = false) {
  const normalized = Push115SubmitUtils.normalizeLink(details?.link, magnetOnly);
  const config = await chrome.storage.local.get([
    'push115_save_path_cid', 'push115_auto_clean_names',
    'push115_name_filter_list', 'push115_auto_delete_empty_folders',
  ]);
  const cid = normalizeMonitorCid(config.push115_save_path_cid ?? '0', true);
  if (!cid) throw new Error('保存目录无效，请在扩展中重新选择');
  const key = `${cid}:${normalized.key}`;
  if (submissionInflight.has(key)) return submissionInflight.get(key);
  const job = (async () => {
    const stored = await chrome.storage.session.get('push115_submission_cache');
    const cached = stored.push115_submission_cache?.[key];
    if (cached && Date.now() - cached.time < 60000) return { accepted: true, duplicate: true, cid };
    let user, token;
    try {
      user = await fetch115Json('https://my.115.com/?ct=ajax&ac=nav');
      token = await fetch115Json('https://115.com/?ct=offline&ac=space', 'GET', null, true);
    } catch (_) { throw new Error('115 登录检查失败，请打开扩展检查登录状态'); }
    const uid = user.data?.user_id;
    if (!uid || !token.sign || !token.time) throw new Error('115 未登录，请打开扩展扫码登录');
    const result = await fetch115Json('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', 'POST', {
      url: normalized.link, uid, sign: token.sign, time: token.time, wp_path_id: cid, savepath: '',
    });
    // 缓存写入串行合并，避免不同任务并发时覆盖。
    const persist = submissionCacheQueue.catch(() => {}).then(async () => {
      const state = await chrome.storage.session.get('push115_submission_cache');
      const cache = state.push115_submission_cache || {};
      for (const id of Object.keys(cache)) if (Date.now() - cache[id].time >= 60000) delete cache[id];
      cache[key] = { time: Date.now() };
      await chrome.storage.session.set({ push115_submission_cache: cache });
    });
    submissionCacheQueue = persist;
    let warning = '';
    try { await persist } catch (_) { warning = '已提交，但重复提交保护未保存'; }
    const filterTerms = config.push115_auto_clean_names
      ? Push115OfflineUtils.normalizeFilterTerms(config.push115_name_filter_list) : [];
    if (filterTerms.length || config.push115_auto_delete_empty_folders) {
      try {
        await startTaskMonitor({
          taskMeta: { id: result.info_hash || normalized.key.replace(/^urn:btih:/, ''), name: result.name || '' },
          savePathCid: cid, filterTerms, deleteEmptyFolders: config.push115_auto_delete_empty_folders === true,
        });
      } catch (_) { warning = '已提交，但自动清理监控启动失败'; }
    }
    return { accepted: true, duplicate: false, cid, warning };
  })();
  submissionInflight.set(key, job);
  try { return await job } finally { submissionInflight.delete(key); }
}


if (globalThis.Push115Updater) {
  updaterBridge = Push115Updater.create({
    runtime: chrome.runtime,
    isPopupSender: sender => sender.url === chrome.runtime.getURL('popup.html'),
    getBusy: async () => {
      if (activeApiRequests > 0 || submissionInflight.size > 0) return true;
      const stored = await chrome.storage.session.get(TASK_MONITOR_STORAGE_KEY);
      return Object.keys(stored[TASK_MONITOR_STORAGE_KEY] || {}).length > 0;
    },
  });
  updaterBridge.confirmStartup().catch(() => {});
}
