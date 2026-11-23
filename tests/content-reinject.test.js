const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const read = file => fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'

function pageFixture() {
	const dom = new JSDOM(`<a id="link" href="${MAGNET}">demo</a>`, { runScripts: 'outside-only', url: 'https://mock.invalid/' })
	const { window } = dom
	const clickHandlers = []
	const addEventListener = window.document.addEventListener.bind(window.document)
	window.document.addEventListener = (type, handler, options) => {
		if (type === 'click') clickHandlers.push(handler)
		return addEventListener(type, handler, options)
	}
	window.chrome = {
		storage: {
			local: { get: async () => ({ push115_auto_detect: true }), set: async () => {} },
			onChanged: { addListener: () => {} },
		},
		runtime: { id: 'test-extension', sendMessage: () => {} },
	}
	const inject = () => {
		for (const file of ['path-utils.js', 'offline-utils.js', 'content.js']) window.eval(read(file))
	}
	const click = () => {
		const target = window.document.getElementById('link')
		const event = { isTrusted: true, target, preventDefault: () => {} }
		for (const handler of clickHandlers) handler(event)
	}
	const modalCount = () => window.document.querySelectorAll('[data-push115-modal-host]').length
	return { window, inject, click, modalCount }
}

test('扩展更新后重复注入 content.js 不报错，且只有最新实例响应', async () => {
	const page = pageFixture()
	page.inject()
	await tick()
	assert.doesNotThrow(() => page.inject())
	await tick()

	page.click()
	assert.equal(page.modalCount(), 1)
	assert.equal(page.window.document.querySelectorAll('style[data-push115-styles]').length, 1)
})

test('扩展上下文失效后旧实例不再拦截链接', async () => {
	const page = pageFixture()
	page.inject()
	await tick()
	delete page.window.chrome.runtime.id

	assert.doesNotThrow(() => page.click())
	assert.equal(page.modalCount(), 0)
})
