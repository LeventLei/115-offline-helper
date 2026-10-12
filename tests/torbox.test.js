const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { JSDOM } = require('jsdom')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const read = file => fs.readFileSync(`extension/${file}`, 'utf8')
const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Reply 1988`
function fixture({ failCopy = false, missing = false, open = false } = {}) {
 const dom = new JSDOM('<head></head><body></body>', {url:'https://torbox.app/dashboard',runScripts:'outside-only',pretendToBeVisual:true})
 const w=dom.window, submits=[], copies=[]
 const original = async value => { if(failCopy) throw new Error('denied');copies.push(value) }
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:original}})
 w.chrome={runtime:{sendMessage:async request=>{submits.push(request);return {success:true,data:{accepted:true}}}}}
 w.postMessage=data=>w.setTimeout(()=>w.dispatchEvent(new w.MessageEvent('message',{data,origin:w.location.origin,source:w})),0)
 const add=w.EventTarget.prototype.addEventListener
 w.EventTarget.prototype.addEventListener=function(type,fn,...args){if(type==='click')this.fixtureClick=fn;return add.call(this,type,fn,...args)}
 function card(id,type='Torrent') {
  const outer=w.document.createElement('button');outer.id=id;outer.setAttribute('aria-expanded','false')
  const body=w.document.createElement('div')
  body.innerHTML=`<span>${type}</span><div class="actions"><div class="grid grid-cols-2"><div><button title="Delete ${type==='Torrent'?'torrent':'web download'}">Delete</button></div></div><div class="more"><div><button aria-expanded="false"><svg><defs><style>.cls-1 { stroke-width: 0px; }</style></defs></svg><span>More</span></button></div></div></div>`
  outer.append(body);w.document.body.append(outer)
  const more=body.querySelector('.more'),trigger=more.querySelector('button')
  function menu(){if(missing)return;const item=w.document.createElement('button');item.className='native-copy';item.textContent='Copy Short Magnet';item.onclick=()=>{w.navigator.clipboard.writeText(magnet);trigger.setAttribute('aria-expanded','false');item.remove()};more.append(item)}
  trigger.onclick=()=>{if(trigger.getAttribute('aria-expanded')==='true'){trigger.setAttribute('aria-expanded','false');more.querySelector('.native-copy')?.remove()}else{trigger.setAttribute('aria-expanded','true');w.setTimeout(menu,10)}}
  if(open){trigger.setAttribute('aria-expanded','true');menu()}
  return outer
 }
 card('one');card('two');card('web','Web')
 w.eval(read('torbox-main.js'));w.eval(read('torbox-content.js'))
 async function trustedClick(id='one'){const b=w.document.querySelector(`#${id} .push115-torbox-shortcut`);await b.fixtureClick({isTrusted:true,preventDefault(){},stopPropagation(){}})}
 return {w,dom,submits,copies,original,card,trustedClick}
}
test('含真实SVG样式及外层button时每任务一个按钮，重绘和重复注入不重复',async()=> {
 const f=fixture();assert.equal(f.w.document.querySelectorAll('.push115-torbox-shortcut').length,2)
 assert.equal(f.w.document.querySelector('#web .push115-torbox-shortcut'),null)
 assert.ok([...f.w.document.querySelectorAll('.push115-torbox-shortcut')].every(b=>b.parentElement.parentElement.classList.contains('grid-cols-2')))
 f.w.eval(read('torbox-content.js'));await wait(30);assert.equal(f.w.document.querySelectorAll('.push115-torbox-shortcut').length,2)
 f.w.document.getElementById('two').remove();f.card('two');await wait(50);assert.equal(f.w.document.querySelectorAll('.push115-torbox-shortcut').length,2)
 f.w.__push115TorboxContent.destroy();f.dom.window.close()
})
test('用户点击流程复制正确任务后提交，恢复剪贴板原方法且不传认证信息',async()=> {
 const f=fixture();await f.trustedClick('two')
 assert.deepEqual(f.copies,[magnet]);assert.equal(f.submits.length,1)
 assert.equal(f.submits[0].action,'SUBMIT_OFFLINE_TASK');assert.equal(f.submits[0].details.link,magnet)
 assert.deepEqual(Object.keys(f.submits[0].details),['link'])
 assert.equal(f.w.navigator.clipboard.writeText,f.original);f.w.__push115TorboxContent.destroy();f.dom.window.close()
})
test('复制拒绝不提交且恢复方法',async()=> {
 const f=fixture({failCopy:true});await f.trustedClick()
 assert.equal(f.submits.length,0);assert.match(f.w.document.querySelector('#push115-torbox-notice').textContent,/复制失败/)
 assert.equal(f.w.navigator.clipboard.writeText,f.original);f.w.__push115TorboxContent.destroy();f.dom.window.close()
})
test('已有菜单直接复制，合成点击与无待处理请求的伪造消息不能提交',async()=> {
 const f=fixture({open:true});await f.trustedClick();assert.equal(f.submits.length,1)
 f.w.document.querySelector('.push115-torbox-shortcut').click()
 f.w.postMessage({channel:'push115-torbox-v1',type:'COPY_RESULT',requestId:'fake',success:true,link:magnet})
 await wait(30);assert.equal(f.submits.length,1);f.w.__push115TorboxContent.destroy();f.dom.window.close()
})
test('菜单缺失2秒超时，方法恢复，按钮可再次操作',async()=> {
 const f=fixture({missing:true});await f.trustedClick()
 assert.equal(f.submits.length,0);assert.equal(f.w.navigator.clipboard.writeText,f.original)
 assert.equal(f.w.document.querySelector('.push115-torbox-shortcut').disabled,false);f.w.__push115TorboxContent.destroy();f.dom.window.close()
})
