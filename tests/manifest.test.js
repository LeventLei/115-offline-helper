const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const manifest = JSON.parse(
	fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'),
)

test('专属版本包含批量处理工具且不声明远程代码', () => {
	assert.equal(manifest.name, 'Levent 115 离线助手')
	assert.equal(manifest.version, '1.1.1')
	assert.ok(manifest.permissions.includes('alarms'))
	assert.ok(!manifest.content_security_policy?.extension_pages?.includes('unsafe-eval'))
})

test('主机权限仅限 115 官方域名，所有网页访问保持可选', () => {
	assert.deepEqual(manifest.host_permissions, ['https://*.115.com/*', 'https://115.com/*'])
	assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*'])
})
