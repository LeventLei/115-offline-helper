// Background Service Worker

importScripts('security-utils.js')

const STORAGE_KEYS = {
  AUTO_DETECT: 'push115_auto_detect',
};

const CONTENT_SCRIPT_ID = 'push115-content-script';
const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];

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

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: '拒绝未知扩展来源' });
    return false;
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
  }
});

function isExtensionPageSender(sender) {
  const extensionRoot = chrome.runtime.getURL('');
  return typeof sender?.url === 'string' && sender.url.startsWith(extensionRoot);
}

async function syncCookieStringToJar(cookieString, options = {}) {
  const { overwrite = true } = options;
  const safeCookieString = Push115SecurityUtils.parseAuthCookie(cookieString);
  const pairs = safeCookieString
    .split(';')
    .map(item => item.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name || !value) continue;

    try {
      if (!overwrite) {
        const existing = await chrome.cookies.get({
          url: 'https://115.com/',
          name,
        });
        if (existing && existing.value) {
          continue;
        }
      }
      await chrome.cookies.set({
        url: 'https://115.com/',
        name,
        value,
        domain: '.115.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction',
      });
    } catch (e) {
      console.warn('Set cookie failed:', name, e?.message || e);
    }
  }
}

async function persistAuthCookieToJar(rawCookie) {
  const cookieString = Push115SecurityUtils.parseAuthCookie(rawCookie);
  if (!cookieString) return '';

  await syncCookieStringToJar(cookieString);

  return cookieString;
}

// Handle generic API requests using fetch
async function handleApiRequest(request, sendResponse) {
  try {
    const { url, method = 'GET', data = null, headers = {} } = request.details || {};
    const normalizedMethod = String(method || 'GET').toUpperCase();
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

    // Persist cookie from qrcode login response for long-term usage
    let responsePayload = responseJson;
    if (
      responseJson &&
      responseJson.state === 1 &&
      responseJson.data &&
      responseJson.data.cookie &&
      new URL(url).hostname === 'passportapi.115.com'
    ) {
      await persistAuthCookieToJar(responseJson.data.cookie);
      responsePayload = Push115SecurityUtils.redactLoginCookie(responseJson);
    }

    sendResponse({
      success: true,
      data: responsePayload || responseText,
      status: response.status,
      statusText: response.statusText
    });
  } catch (error) {
    console.error('API Request Error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}
