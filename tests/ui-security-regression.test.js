const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const extensionDir = path.join(__dirname, '..', 'extension')
const read = file => fs.readFileSync(path.join(extensionDir, file), 'utf8')

test('弹窗提供批量链接、完整目录文字和广告过滤配置', () => {
	const html = read('popup.html')
	const css = read('popup.css')

	assert.match(html, /id="push115-links-input"/)
	assert.match(html, /id="push115-name-filters-input"/)
	assert.match(html, /id="push115-auto-clean-names"/)
	assert.match(html, /push115-path-select-wrapper/)
	assert.doesNotMatch(html, /id="push115-selected-path"/)
	assert.doesNotMatch(html, /id="push115-clean-names"/)
	assert.doesNotMatch(css, /\.push115-selected-path/)
})

test('名称广告清理由推送流程中的复选框控制', () => {
	const popup = read('popup.js')
	const content = read('content.js')

	assert.match(popup, /AUTO_CLEAN_NAMES/)
	assert.match(content, /AUTO_CLEAN_NAMES/)
	assert.match(content, /cleanNamesRecursively/)
})

test('网页确认界面位于 closed Shadow DOM 且只接受可信用户手势', () => {
	const source = read('content.js')

	assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/)
	assert.match(source, /event\?\.isTrusted/)
	assert.match(source, /navigator\.userActivation\.isActive/)
	assert.match(source, /!getConfig\(CONFIG_KEYS\.AUTO_DETECT\)/)
	assert.doesNotMatch(source, /按保存目录执行一次兜底处理/)
})

test('后台不再暴露 Cookie 读取消息或把认证信息写入扩展存储', () => {
	const source = read('background.js')

	assert.doesNotMatch(source, /GET_COOKIE|SET_COOKIE|push115_cookie/)
	assert.doesNotMatch(source, /expirationDate/)
	assert.match(source, /httpOnly: true/)
	assert.match(source, /isAllowedApiRequest/)
	assert.doesNotMatch(source, /CLEAN_NAMES/)
})
