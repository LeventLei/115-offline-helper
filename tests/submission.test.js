const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const utils = require('../extension/submit-utils')
const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Reply 1988`
function setup({ rejection = false, loggedIn = true } = {}) {
 const session = {}, calls = [], local = { push115_save_path_cid: '123' }
 let listener, failed = rejection
 const event = { addListener() {} }
 const context = { console, URL, URLSearchParams, crypto: { randomUUID: () => 'id' }, importScripts() {},
  Push115SubmitUtils: utils, Push115OfflineUtils: require('../extension/offline-utils'), Push115SecurityUtils: require('../extension/security-utils'),
  chrome: { runtime: { id:'ext', getURL:()=> 'chrome-extension://ext/', onInstalled:event,onStartup:event,onMessage:{addListener: fn => listener=fn}},
   storage: { local: { get:async()=>local }, session:{ get:async()=>structuredClone(session),set:async value=>Object.assign(session,value)},onChanged:event },
   alarms:{onAlarm:event,create:async()=>{},clear:async()=>{}},scripting:{},permissions:{},cookies:{} },
  fetch:async(url,options={})=> {
   calls.push({url,options})
   let data
   if(url.includes('ac=nav')) data = {state:loggedIn,data: loggedIn ? {user_id:'uid'} : {},error:'未登录'}
   else if(url.includes('ac=space')) data = {sign:'sign',time:123}
   else data = failed ? {state:false,error_msg:'需验证'} : {state:true,info_hash:'a'.repeat(40)}
   return {ok:true,status:200,text:async()=>JSON.stringify(data)}
  }
 }
 vm.createContext(context);vm.runInContext(fs.readFileSync('extension/background.js','utf8'),context)
 return {context,calls,local,session,retry:()=>{failed=false},send:(sender,link=magnet)=>new Promise(resolve=>listener({action:'SUBMIT_OFFLINE_TASK',details:{link}},sender,resolve))}
}
const sender = {id:'ext',url:'https://torbox.app/dashboard',frameId:0,tab:{id:1}}
test('磁力完整验证、名称空格编码和伪造来源拒绝',()=> {
 assert.equal(utils.normalizeLink(magnet).key,`urn:btih:${'a'.repeat(40)}`)
 assert.match(utils.normalizeLink(magnet).link,/Reply\+1988/)
 for(const raw of ['https://x.test','magnet:?xt=urn:btih:abc',`${magnet}&xt=urn:btih:${'b'.repeat(40)}`]) assert.throws(()=>utils.normalizeLink(raw))
 assert.ok(utils.isTorBoxSender(sender))
 assert.ok(!utils.isTorBoxSender({...sender,frameId:1}))
 assert.ok(!utils.isTorBoxSender({...sender,url:'https://torbox.app.evil.test/dashboard'}))
})
test('并发只提交一次、成功60秒去重、目录由存储读取',async()=> {
 const s=setup()
 const [a,b]=await Promise.all([s.send(sender),s.send(sender)])
 assert.equal(a.success,true);assert.equal(b.success,true)
 assert.equal(s.calls.filter(c=>c.options.method==='POST').length,1)
 assert.equal(new URLSearchParams(s.calls.find(c=>c.options.method==='POST').options.body).get('wp_path_id'),'123')
 assert.equal((await s.send(sender)).data.duplicate,true)
 s.local.push115_save_path_cid='456'
 assert.equal((await s.send(sender)).data.duplicate,false)
 assert.equal(s.calls.filter(c=>c.options.method==='POST').length,2)
})
test('接口拒绝不返回成功、不缓存，修复后可重试',async()=> {
 const s=setup({rejection:true});const result=await s.send(sender)
 assert.equal(result.success,false);assert.match(result.error,/需验证/)
 assert.equal(s.session.push115_submission_cache,undefined)
 s.retry();assert.equal((await s.send(sender)).success,true)
})
test('未登录或非法来源不创建任务',async()=> {
 const s=setup({loggedIn:false});assert.equal((await s.send(sender)).success,false)
 assert.equal(s.calls.filter(c=>c.options.method==='POST').length,0)
 const other=setup();for(const bad of [{...sender,id:'evil'},{...sender,frameId:1},{...sender,url:'https://example.com'}]) assert.equal((await other.send(bad)).success,false)
 assert.equal(other.calls.length,0)
})
test('session缓存过期后允许再次提交',async()=> {
 const s=setup();await s.send(sender)
 const cached=s.session.push115_submission_cache
 const key=Object.keys(cached)[0];cached[key].time-=61000
 await s.send(sender);assert.equal(s.calls.filter(c=>c.options.method==='POST').length,2)
})

test('已有session记录在后台初始化后仍去重', async()=> {
 const s=setup()
 s.session.push115_submission_cache = { [`123:urn:btih:${'a'.repeat(40)}`]: {time:Date.now()} }
 assert.equal((await s.send(sender)).data.duplicate,true)
 assert.equal(s.calls.length,0)
})
