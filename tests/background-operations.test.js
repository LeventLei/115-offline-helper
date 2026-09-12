const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function createBackgroundContext(rows) {
	const calls = []
	const context = {
		console,
		URL,
		URLSearchParams,
		importScripts: () => {},
		crypto: { randomUUID: () => 'test-monitor-id' },
		Push115SecurityUtils: {
			isAllowedApiRequest: () => true,
			parseAuthCookie: () => '',
		},
		Push115OfflineUtils: {
			normalizeFilterTerms: value => value || [],
			sanitizeName: name => name,
			isEmptyFolderItems: items => Array.isArray(items) && items.length === 0,
		},
		chrome: {
			runtime: {
				id: 'test-extension',
				getURL: () => 'chrome-extension://test-extension/',
				onInstalled: { addListener: () => {} },
				onStartup: { addListener: () => {} },
				onMessage: { addListener: () => {} },
			},
			scripting: {
				unregisterContentScripts: async () => {},
				registerContentScripts: async () => {},
				executeScript: async () => {},
			},
			storage: {
				local: { get: async () => ({}), set: async () => {} },
				session: { get: async () => ({}), set: async () => {} },
				onChanged: { addListener: () => {} },
			},
			permissions: { contains: async () => true, remove: async () => true },
			alarms: { onAlarm: { addListener: () => {} }, clear: async () => true, create: async () => {} },
			cookies: { set: async () => {}, get: async () => null },
		},
	}

	context.fetch = async (url, options = {}) => {
		calls.push({ url, method: options.method || 'GET', body: options.body })
		const parsed = new URL(url)
		if (parsed.pathname === '/rb/delete') {
			const body = new URLSearchParams(options.body)
			const deletedId = body.get('fid[0]')
			delete rows[deletedId]
			for (const key of Object.keys(rows)) {
				rows[key] = rows[key].filter(item => String(item.fid) !== deletedId)
			}
			return { ok: true, text: async () => JSON.stringify({ state: true }) }
		}

		const cid = parsed.searchParams.get('cid')
		return { ok: true, text: async () => JSON.stringify({ state: true, data: rows[cid] || [] }) }
	}

	vm.createContext(context)
	vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), context)
	return { context, calls }
}

test('后台空文件夹清理按后序顺序删除空子目录但保留任务根目录', async () => {
	const rows = {
		'100': [
			{ fid: '200', n: '空父目录' },
			{ fid: '300', n: 'keep.txt', sha: 'file-sha' },
		],
		'200': [{ fid: '201', n: '空子目录' }],
		'201': [],
	}
	const { context, calls } = createBackgroundContext(rows)

	const result = await vm.runInContext('deleteEmptyFoldersForMonitor("100")', context)
	const deletedIds = calls
		.filter(call => call.method === 'POST')
		.map(call => new URLSearchParams(call.body).get('fid[0]'))

	assert.deepEqual(JSON.parse(JSON.stringify(result)), { scanned: 3, deleted: 2, truncated: false })
	assert.deepEqual(deletedIds, ['201', '200'])
	assert.deepEqual(rows['100'], [{ fid: '300', n: 'keep.txt', sha: 'file-sha' }])
})
