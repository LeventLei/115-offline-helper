const test = require('node:test')
const assert = require('node:assert/strict')

const {
	isAllowedApiRequest,
	parseAuthCookie,
	redactLoginCookie,
} = require('../extension/security-utils.js')

test('仅允许扩展实际使用的 115 官方接口与方法', () => {
	assert.equal(isAllowedApiRequest('https://115.com/?ct=offline&ac=space', 'GET'), true)
	assert.equal(isAllowedApiRequest('https://115.com/web/lixian/?ct=lixian&ac=add_task_urls', 'POST'), true)
	assert.equal(isAllowedApiRequest('https://webapi.115.com/files/edit', 'POST'), true)
	assert.equal(isAllowedApiRequest('https://qrcodeapi.115.com/get/status/?uid=x&time=1&sign=y', 'GET'), true)
	assert.equal(isAllowedApiRequest('https://passportapi.115.com/app/1.0/android/1.0/login/qrcode/', 'POST'), true)
})

test('拒绝第三方、非 HTTPS、未知 115 接口和错误方法', () => {
	assert.equal(isAllowedApiRequest('not a url', 'GET'), false)
	assert.equal(isAllowedApiRequest('https://evil.example/collect', 'POST'), false)
	assert.equal(isAllowedApiRequest('http://115.com/?ct=offline&ac=space', 'GET'), false)
	assert.equal(isAllowedApiRequest('https://115.com/unknown', 'GET'), false)
	assert.equal(isAllowedApiRequest('https://webapi.115.com/rb/delete', 'GET'), false)
	assert.equal(isAllowedApiRequest('https://passportapi.115.com/app/1.0/unknown/1.0/login/qrcode/', 'POST'), false)
})

test('允许其余只读官方接口并拒绝错误查询组合', () => {
	assert.equal(isAllowedApiRequest('https://my.115.com/?ct=guide&ac=status', 'GET'), true)
	assert.equal(isAllowedApiRequest('https://my.115.com/?ct=guide&ac=nav', 'GET'), false)
	assert.equal(isAllowedApiRequest('https://webapi.115.com/files?cid=1', 'GET'), true)
	assert.equal(isAllowedApiRequest('https://qrcodeapi.115.com/api/1.0/web/1.0/token/', 'GET'), true)
	assert.equal(isAllowedApiRequest('https://qrcodeapi.115.com/unknown', 'GET'), false)
})

test('只保留 115 登录所需的三个认证 Cookie', () => {
	assert.equal(
		parseAuthCookie('UID=1; CID=2; SEID=3; analytics=track-me; theme=dark'),
		'UID=1; CID=2; SEID=3',
	)
	assert.equal(parseAuthCookie({ UID: '1', CID: '2', SEID: '3', other: 'secret' }), 'UID=1; CID=2; SEID=3')
})

test('向弹窗返回登录结果前移除 Cookie 明文', () => {
	const response = { state: 1, data: { cookie: { UID: '1', CID: '2', SEID: '3' }, user_id: 42 } }
	const redacted = redactLoginCookie(response)

	assert.deepEqual(redacted, { state: 1, data: { user_id: 42, cookie_saved: true } })
	assert.ok(response.data.cookie)
	assert.equal(redactLoginCookie(null), null)
	assert.deepEqual(redactLoginCookie({ state: 0 }), { state: 0 })
})
