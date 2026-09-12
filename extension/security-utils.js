;(function (global) {
	'use strict'

	const AUTH_COOKIE_NAMES = ['UID', 'CID', 'SEID']
	const ALLOWED_LOGIN_APPS = new Set([
		'web',
		'ios',
		'android',
		'ipad',
		'tv',
		'qios',
		'qandroid',
		'wechatmini',
		'alipaymini',
	])

	function isAllowedApiRequest(rawUrl, rawMethod = 'GET') {
		let url
		try {
			url = new URL(rawUrl)
		} catch (_) {
			return false
		}

		const method = String(rawMethod || 'GET').toUpperCase()
		if (url.protocol !== 'https:') return false

		if (url.hostname === 'my.115.com' && url.pathname === '/' && method === 'GET') {
			const ct = url.searchParams.get('ct')
			const ac = url.searchParams.get('ac')
			return (ct === 'ajax' && ac === 'nav') || (ct === 'guide' && ac === 'status')
		}

		if (url.hostname === '115.com' && url.pathname === '/' && method === 'GET') {
			return url.searchParams.get('ct') === 'offline' && url.searchParams.get('ac') === 'space'
		}

		if (url.hostname === '115.com' && url.pathname === '/web/lixian/') {
			if (url.searchParams.get('ct') !== 'lixian') return false
			const action = url.searchParams.get('ac')
			return (method === 'GET' && action === 'task_lists') ||
				(method === 'POST' && ['add_task_url', 'add_task_urls'].includes(action))
		}

		if (url.hostname === 'webapi.115.com') {
			if (method === 'GET' && url.pathname === '/files') return true
			return method === 'POST' && ['/files/add', '/files/move', '/files/edit', '/rb/delete'].includes(url.pathname)
		}

		if (url.hostname === 'qrcodeapi.115.com') {
			return method === 'GET' && [
				'/api/1.0/web/1.0/token/',
				'/get/status/',
			].includes(url.pathname)
		}

		if (url.hostname === 'passportapi.115.com' && method === 'POST') {
			const match = url.pathname.match(/^\/app\/1\.0\/([^/]+)\/1\.0\/login\/qrcode\/$/)
			return Boolean(match && ALLOWED_LOGIN_APPS.has(match[1]))
		}

		return false
	}

	function parseAuthCookie(rawCookie) {
		const source = typeof rawCookie === 'string'
			? rawCookie.split(';').reduce((result, pair) => {
				const index = pair.indexOf('=')
				if (index > 0) result[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
				return result
			}, {})
			: rawCookie && typeof rawCookie === 'object' ? rawCookie : {}

		return AUTH_COOKIE_NAMES
			.filter(name => typeof source[name] === 'string' && source[name])
			.map(name => `${name}=${source[name]}`)
			.join('; ')
	}

	function redactLoginCookie(response) {
		if (!response || typeof response !== 'object' || !response.data || typeof response.data !== 'object') return response
		const redacted = { ...response, data: { ...response.data } }
		if ('cookie' in redacted.data) {
			delete redacted.data.cookie
			redacted.data.cookie_saved = true
		}
		return redacted
	}

	const api = { isAllowedApiRequest, parseAuthCookie, redactLoginCookie }
	global.Push115SecurityUtils = api
	if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof self !== 'undefined' ? self : globalThis)
