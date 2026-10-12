const test = require('node:test')
const assert = require('node:assert/strict')
const {create} = require('../extension/updater-bridge')
function fixture({busy=false,helperMissing=false,result={success:true,data:{installed:true}}}={}) {
 const calls=[],reloaded=[],scheduled=[]
 const runtime={id:'ext', getManifest:()=>({version:'1.3.0'}),reload:()=>reloaded.push(true),sendNativeMessage:async(...args)=>{calls.push(args);if(helperMissing)throw new Error('sensitive browser detail');return result}}
 const bridge=create({runtime,isPopupSender:s=>s.url==='chrome-extension://ext/popup.html',getBusy:async()=>busy,schedule:fn=>scheduled.push(fn)})
 return {bridge,calls,reloaded,scheduled}
}
const sender={id:'ext',url:'chrome-extension://ext/popup.html'}
test('仅弹窗可操作更新，内容脚本和其他扩展来源拒绝',async()=> {
 const f=fixture()
 for(const bad of [{...sender,id:'other'}, {...sender,url:'https://torbox.app/dashboard'}, {...sender,url:'chrome-extension://ext/other.html'}]) assert.equal((await f.bridge.handle({action:'UPDATER_INSTALL'},bad)).code,'FORBIDDEN')
 assert.equal(f.calls.length,0)
})
test('更新请求拒绝任意路径地址或其他参数',async()=> {
 const f=fixture();assert.equal((await f.bridge.handle({action:'UPDATER_INSTALL',details:{path:'outside'}},sender)).code,'INVALID_MESSAGE');assert.equal(f.calls.length,0)
})
test('提交或后处理未结束时暂缓更新',async()=> {
 const f=fixture({busy:true});assert.equal((await f.bridge.handle({action:'UPDATER_INSTALL'},sender)).code,'TASKS_BUSY');assert.equal(f.calls.length,0)
})
test('安装成功才安排重载，无更新或失败不重载',async()=> {
 for(const result of [{success:true,data:{installed:true}},{success:true,data:{installed:false}},{success:false,error:'failed'}]) {
  const f=fixture({result});await f.bridge.handle({action:'UPDATER_INSTALL'},sender)
  assert.equal(f.scheduled.length,result.success&&result.data?.installed===true?1:0)
  f.scheduled.forEach(fn=>fn());assert.equal(f.reloaded.length,f.scheduled.length)
  assert.deepEqual(f.calls[0][1],{protocol:1,action:'install'})
 }
})
test('助手不可用只显示固定提示，不显示原始错误',async()=> {
 const f=fixture({helperMissing:true});const r=await f.bridge.handle({action:'UPDATER_CHECK'},sender)
 assert.equal(r.code,'HELPER_UNAVAILABLE');assert.ok(!JSON.stringify(r).includes('sensitive'))
})
test('启动仅确认版本，不检查网络或自动安装',async()=> {
 const f=fixture();await f.bridge.confirmStartup();assert.deepEqual(f.calls[0][1],{protocol:1,action:'confirm',version:'1.3.0'})
})
test('并发更新合并保护，不重复调用助手',async()=> {
 let release
 const runtime={id:'ext',sendNativeMessage:()=>new Promise(resolve=>{release=resolve}),reload() {}}
 const f=create({runtime,isPopupSender:()=>true,getBusy:async()=>false,schedule:()=>{}})
 const first=f.handle({action:'UPDATER_INSTALL'},sender)
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal((await f.handle({action:'UPDATER_INSTALL'},sender)).code,'BUSY')
 release({success:true,data:{installed:false}});await first;assert.equal(f.isInstalling(),false)
})

test('安装后保持更新锁，阻止重载前新任务进入',async()=> {
 const f=fixture();await f.bridge.handle({action:'UPDATER_INSTALL'},sender)
 assert.equal(f.bridge.isInstalling(),true)
 assert.equal((await f.bridge.handle({action:'UPDATER_INSTALL'},sender)).code,'BUSY')
})
