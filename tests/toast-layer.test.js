const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const read = file => fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8')
const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'

function page(popover) {
	const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://mock.invalid/' })
	const { window } = dom
	const calls = []
	if (popover) {
		const proto = window.HTMLElement.prototype
		proto.showPopover = function showPopover() {
			calls.push('showPopover')
			if (popover === 'throw' || this.hasAttribute('data-popover-open')) {
				const error = new Error('popover failed')
				error.name = 'InvalidStateError'
				throw error
			}
			this.setAttribute('data-popover-open', '')
		}
		proto.hidePopover = function hidePopover() {
			calls.push('hidePopover')
			if (!this.hasAttribute('data-popover-open')) {
				const error = new Error('popover closed')
				error.name = 'InvalidStateError'
				throw error
			}
			this.removeAttribute('data-popover-open')
		}
	}
	window.chrome = {
		storage: {
			local: { get: async () => ({}), set: async () => {} },
			onChanged: { addListener: () => {} },
		},
		runtime: { id: 'test-extension', sendMessage: () => {} },
	}
	const content = read('content.js').replace(/\(\(\) => \{\n/, '').replace(/\n\}\)\(\)\s*$/, '')
	for (const file of ['path-utils.js', 'offline-utils.js']) window.eval(read(file))
	window.eval(content)
	return { window, calls }
}

function stackAfterHost(window) {
	const nodes = [...window.document.querySelectorAll('[data-push115-modal-host], #push115-toast-stack')]
	assert.equal(nodes.at(-1).id, 'push115-toast-stack')
	assert.ok(nodes.some(node => node.hasAttribute('data-push115-modal-host')))
}

test('支持 popover 时提示栈进入 top layer，弹窗前后都会重新置顶', () => {
	const { window, calls } = page(true)
	window.eval("showToast('success', '先出现')")
	const stack = window.document.getElementById('push115-toast-stack')
	assert.equal(stack.getAttribute('popover'), 'manual')
	assert.deepEqual(calls, ['showPopover'])

	window.eval(`createConfirmModal(['${MAGNET}'], 'Magnet')`)
	assert.deepEqual(calls, ['showPopover', 'hidePopover', 'showPopover'])
	assert.equal(stack.getAttribute('popover'), 'manual')
	assert.equal(stack.isConnected, true)

	calls.length = 0
	const again = page(true)
	again.window.eval(`createConfirmModal(['${MAGNET}'], 'Magnet')`)
	again.window.eval("showStickyToast('info', '后出现')")
	const later = again.window.document.getElementById('push115-toast-stack')
	assert.equal(later.getAttribute('popover'), 'manual')
	assert.deepEqual(again.calls, ['showPopover'])
	again.window.eval("showToast('success', '再提前')")
	assert.deepEqual(again.calls, ['showPopover', 'hidePopover', 'showPopover'])
})

test('不支持 popover 或 showPopover 失败时，提示栈排在弹窗 host 之后', () => {
	for (const mode of [false, 'throw']) {
		const shownFirst = page(mode)
		shownFirst.window.eval("showToast('info', '先提示')")
		shownFirst.window.eval(`createConfirmModal(['${MAGNET}'], 'Magnet')`)
		stackAfterHost(shownFirst.window)
		const stack = shownFirst.window.document.getElementById('push115-toast-stack')
		assert.equal(stack.hasAttribute('popover'), false)
		assert.equal(stack.parentElement, shownFirst.window.document.documentElement)

		const modalFirst = page(mode)
		modalFirst.window.eval(`createConfirmModal(['${MAGNET}'], 'Magnet')`)
		modalFirst.window.eval("showStickyToast('warning', '后提示')")
		stackAfterHost(modalFirst.window)
		assert.equal(modalFirst.window.document.getElementById('push115-toast-stack').hasAttribute('popover'), false)
	}
})

test('空提示栈关闭 popover，且不拦截点击', () => {
	const { window, calls } = page(true)
	window.eval("injectModalStyles(); showStickyToast('info', '处理中'); hideStickyToast()")
	const stack = window.document.getElementById('push115-toast-stack')
	assert.equal(stack.childElementCount, 0)
	assert.deepEqual(calls, ['showPopover', 'hidePopover'])
	const style = window.document.querySelector('style[data-push115-styles]').textContent
	assert.match(style, /pointer-events:\s*none/)
	assert.match(style, /:empty \{ display: none/)
	assert.match(style, /inset:\s*auto/)
	assert.match(style, /margin:\s*0/)
	assert.match(style, /border:\s*none/)
	assert.match(style, /\[popover\]:not\(:popover-open\)/)
})
