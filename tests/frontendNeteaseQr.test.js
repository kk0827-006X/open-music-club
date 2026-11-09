const { it }=require('node:test')
const assert=require('node:assert/strict')
const { withReactHarness }=require('./helpers/reactHarness')
const reply=body=>({ok:true,status:200,json:async()=>body})
const account={success:true,enabled:true,mode:'qrcode',connected:false,storage:'encrypted',storageError:false}
const qr={success:true,ticket:'a'.repeat(32),qrImage:'data:image/png;base64,aGVsbG8=',expiresAt:Date.now()+180000,state:'waiting'}
async function clock(h,run){
  const nativeSet=h.window.setTimeout.bind(h.window),nativeClear=h.window.clearTimeout.bind(h.window),timers=new Map();let id=100000
  h.window.setTimeout=(fn,delay,...args)=>{if(delay!==3000)return nativeSet(fn,delay,...args);timers.set(++id,fn);return id}
  h.window.clearTimeout=handle=>{if(!timers.delete(handle))nativeClear(handle)}
  const tick=async()=>{const pending=[...timers.values()];timers.clear();assert.equal(pending.length,1);await h.React.act(async()=>pending[0]());await h.flush()}
  try{await run({tick,timers})}finally{h.window.setTimeout=nativeSet;h.window.clearTimeout=nativeClear}
}
it('只有管理员设置面板显示网易云账号入口，普通成员不加载管理请求',async()=>{
  let calls=0
  await withReactHarness(async h=>{
    const { SettingsDialog }=await import('../frontend/src/features/settings/SettingsDialog.tsx')
    const ref=h.React.createRef()
    const render=role=>h.render(h.React.createElement(SettingsDialog,{ref,role,onOpen(){},onClose(){}}))
    await render('user');await h.React.act(async()=>ref.current.show());await h.click('[data-settings-category="account"]')
    assert.equal(h.query('[data-settings-netease]'),null);assert.equal(calls,0)
    await render('admin');await h.click('[data-settings-netease]')
    assert.ok(h.query('[data-netease-account-panel]'));assert.equal(calls,1)
    assert.match(h.document.body.textContent,/服务器加密保存/)
  },{fetch:async()=>{calls++;return reply(account)}})
})
it('扫码轮询串行等待确认再连接，不在浏览器保存Cookie，退出只更新全站网易云状态',async()=>{
  const calls=[],states=['waiting','confirming','connected'];let connected=false
  await withReactHarness(async h=>clock(h,async c=>{
    const { NeteaseAccountPanel }=await import('../frontend/src/features/settings/NeteaseAccountPanel.tsx')
    await h.render(h.React.createElement(NeteaseAccountPanel))
    await h.click('[data-netease-qr-start]')
    assert.ok(h.query('.netease-login-qr'))
    await c.tick();assert.match(h.require('[data-netease-feedback]').textContent,/等待/)
    await c.tick();assert.match(h.require('[data-netease-feedback]').textContent,/请在网易云音乐 App 中确认/)
    await c.tick();assert.equal(h.query('.netease-login-qr'),null)
    assert.match(h.require('[data-netease-connection]').textContent,/已连接/)
    assert.equal(c.timers.size,0)
    assert.equal(h.window.localStorage.length,0)
    await h.click('[data-netease-logout]')
    assert.match(h.require('[data-netease-connection]').textContent,/未连接/)
    assert.equal(calls.filter(c=>c.url.endsWith('/qr/check')).length,3)
    assert.ok(calls.filter(c=>c.init?.method==='POST').every(c=>c.init.headers['X-CSRF-Token']==='token'))
  }),{fetch:async(url,init)=>{
    calls.push({url,init})
    if(url.includes('csrf-token'))return reply({csrfToken:'token'})
    if(url.endsWith('/status'))return reply({...account,connected})
    if(url.endsWith('/qr'))return reply(qr)
    if(url.endsWith('/qr/check')){const state=states.shift();if(state==='connected')connected=true;return reply({success:true,state})}
    if(url.endsWith('/logout'))connected=false
    return reply({success:true})
  }})
})
it('离开扫码面板停止轮询、取消票据；迟到响应不恢复二维码',async()=>{
  let release,signal,cancels=0,csrfReads=0
  await withReactHarness(async h=>clock(h,async c=>{
    const { NeteaseAccountPanel }=await import('../frontend/src/features/settings/NeteaseAccountPanel.tsx')
    await h.render(h.React.createElement(NeteaseAccountPanel));await h.click('[data-netease-qr-start]')
    await c.tick();assert.ok(signal);assert.equal(signal.aborted,false)
    await h.unmount();await h.flush();assert.equal(signal.aborted,true);assert.equal(c.timers.size,0)
    assert.equal(cancels,1);assert.equal(csrfReads,2,'卸载取消不再请求新的CSRF会话')
    release(reply({success:true,state:'connected'}));await h.flush()
    assert.equal(h.query('[data-netease-account-panel]'),null)
  }),{fetch:async(url,init)=>{
    if(url.includes('csrf-token')){csrfReads++;return reply({csrfToken:'token'})}
    if(url.endsWith('/status'))return reply(account)
    if(url.endsWith('/qr'))return reply(qr)
    if(url.endsWith('/qr/cancel')){cancels++;return reply({success:true})}
    signal=init.signal;return new Promise(resolve=>{release=resolve})
  }})
})
it('过期停止轮询；拒绝非PNG二维码、未知模式与非JSON代理原文',async()=>{
  const { readNeteaseQr,readNeteaseStatus,neteaseSessionRequest }=await import('../frontend/src/services/music/netease-session.ts')
  assert.throws(()=>readNeteaseQr({...qr,qrImage:'https://evil.test/qr'}))
  assert.throws(()=>readNeteaseStatus({...account,mode:'evil'}))
  await withReactHarness(async h=>clock(h,async c=>{
    const { NeteaseAccountPanel }=await import('../frontend/src/features/settings/NeteaseAccountPanel.tsx')
    await h.render(h.React.createElement(NeteaseAccountPanel));await h.click('[data-netease-qr-start]');await c.tick()
    assert.match(h.require('[data-netease-feedback]').textContent,/过期/);assert.equal(c.timers.size,0)
  }),{fetch:async url=>reply(url.includes('csrf-token')?{csrfToken:'token'}:url.endsWith('/status')?account:url.endsWith('/qr')?qr:{success:true,state:'expired'})})
  await withReactHarness(async()=>{
    await assert.rejects(()=>neteaseSessionRequest('status',undefined,new AbortController().signal),error=>{assert.equal(error.message,'服务响应暂时不可用，请稍后重试');return true})
  },{fetch:async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('private Cookie=secret')}})})
})
