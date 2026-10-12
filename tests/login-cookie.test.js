const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const security = require('../extension/security-utils')
const now = 1700000000
const ttl = 30 * 24 * 60 * 60
const sample = { UID: 'sample-uid', CID: 'sample-cid', SEID: 'sample-seid' }
function setup({ existing = {}, failAt = '', noResult = false, failGet = false, response, networkFailure = false } = {}) {
 const calls = [], logs = [], stores = []
 const event = { addListener() {} }
 const context = {
  URL, URLSearchParams, Date: { now: () => now * 1000 }, importScripts() {},
  console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  Push115SecurityUtils: security,
  chrome: {
   runtime: { id: 'ext', onInstalled: event, onStartup: event, onMessage: event },
   storage: { local: { get: async () => ({}) }, session: { get: async () => ({}), set: async data => stores.push(data) }, onChanged: event },
   scripting: {}, permissions: {}, alarms: { onAlarm: event },
   cookies: {
    get: async ({ name }) => { if (failGet) throw new Error(sample.SEID); return existing[name] || null },
    set: async details => {
     calls.push(details)
     if (details.name === failAt) throw new Error('browser detail: ' + sample.SEID)
     return noResult ? undefined : { ...details, session: false }
    },
   },
  },
  fetch: async () => {
   if (networkFailure) throw new Error('network detail: ' + sample.SEID)
   return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(response || { state: 1, data: { cookie: sample } }) }
  },
 }
 vm.createContext(context)
 vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), context)
 const write = cookie => context.persistAuthCookieToJar(cookie)
 const login = () => new Promise(resolve => context.handleApiRequest({ details: { url: 'https://passportapi.115.com/app/1.0/alipaymini/1.0/login/qrcode/', method: 'POST' } }, resolve))
 return { context, calls, logs, stores, write, login }
}
test('扫码认证Cookie写入30天持久期限并保留安全属性', async () => {
 const f = setup(); assert.equal(await f.write(sample), true); assert.equal(f.calls.length, 3)
 for (const cookie of f.calls) {
  assert.equal(cookie.expirationDate, now + ttl)
  assert.equal(cookie.url, 'https://115.com/'); assert.equal(cookie.domain, '.115.com'); assert.equal(cookie.path, '/')
  assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'no_restriction')
 }
 assert.equal(f.stores.length, 0)
})
test('同值Cookie保留更短期限、超过30天则封顶，其他新字段使用默认期限', async () => {
 const f = setup({ existing: {
  UID: { value: sample.UID, expirationDate: now + 3600, session: false },
  CID: { value: sample.CID, expirationDate: now + ttl * 2, session: false },
 } })
 await f.write(sample)
 assert.equal(f.calls.find(x => x.name === 'UID').expirationDate, now + 3600)
 assert.equal(f.calls.find(x => x.name === 'CID').expirationDate, now + ttl)
 assert.equal(f.calls.find(x => x.name === 'SEID').expirationDate, now + ttl)
})
test('新Cookie值不继承旧值期限', async () => {
 const f = setup({ existing: { UID: { value: 'old-uid', expirationDate: now + 100, session: false } } })
 await f.write(sample); assert.equal(f.calls[0].expirationDate, now + ttl)
})
test('过期或会话Cookie使用新的持久期限', async () => {
 const f = setup({ existing: { UID: { value: sample.UID, expirationDate: now - 1, session: false }, CID: { value: sample.CID, session: true } } })
 await f.write(sample); assert.ok(f.calls.every(x => x.expirationDate === now + ttl))
})
test('字段缺失或空值在写入前拒绝', async () => {
 for (const raw of [undefined, {}, {UID:'sample',CID:'sample'}, {...sample,SEID:''}]) {
  const f = setup(); await assert.rejects(f.write(raw), /缺少完整认证信息/); assert.equal(f.calls.length, 0)
 }
})
test('对象值中的额外Cookie注入不被写入', async () => {
 const f = setup(); await assert.rejects(f.write({...sample,UID:'sample; injected=x'}), /缺少完整认证信息/)
 assert.equal(f.calls.length, 0)
})
test('Cookie写入失败或无结果不报登录成功，也不记录浏览器错误或凭据', async () => {
 for (const options of [{failAt:'SEID'}, {noResult:true}, {failGet:true}]) {
  const f = setup(options); const result = await f.login()
  assert.equal(result.success, false); assert.match(result.error, /写入失败/)
  assert.equal(result.data, undefined); assert.equal(f.logs.length, 0); assert.equal(f.stores.length, 0)
  assert.ok(!JSON.stringify(result).includes(sample.SEID))
 }
})
test('登录响应缺少Cookie或含部分字段不返回cookie_saved', async () => {
 for (const data of [{}, {cookie:{UID:'sample'}}]) {
  const f = setup({response:{state:1,data}}); const result = await f.login()
  assert.equal(result.success, false); assert.match(result.error, /缺少完整认证信息/); assert.equal(f.calls.length, 0)
 }
})
test('三项写入完成才返回脱敏成功响应', async () => {
 const f = setup(); const result = await f.login()
 assert.equal(result.success, true); assert.equal(result.data.data.cookie_saved, true)
 assert.equal(result.data.data.cookie, undefined); assert.equal(f.calls.length, 3)
 assert.ok(!JSON.stringify(result).includes(sample.SEID)); assert.equal(f.stores.length, 0)
})
test('服务端拒绝或网络错误不带出响应Cookie及原错误细节', async () => {
 for (const options of [{response:{state:0,data:{cookie:sample},error:sample.SEID}}, {networkFailure:true}]) {
  const f = setup(options); const result = await f.login()
  assert.equal(result.success, false); assert.equal(result.error, '登录失败，请重新扫码或检查扩展权限')
  assert.equal(f.calls.length, 0); assert.equal(f.logs.length, 0)
 }
})
