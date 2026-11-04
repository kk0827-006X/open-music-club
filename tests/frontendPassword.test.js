const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
it('设置改密独立入口，密码规则和确认预检，失败清除机密且可重试，成功只提交一次', async () => {
  const calls=[]
  let reject=true, done=0
  await withReactHarness(async h => {
    const { PasswordForm }=await import('../frontend/src/features/auth/PasswordForm.tsx')
    await h.render(h.React.createElement(PasswordForm,{mode:'change',onComplete:()=>done++}))
    await h.input('[name="newPassword"]','weak'); await h.input('[name="confirm"]','weak'); await h.submit('[data-password-form]')
    assert.equal(calls.length,0)
    const fill=async()=>{ await h.input('[name="oldPassword"]','Old-password1!'); await h.input('[name="newPassword"]','New-password2!'); await h.input('[name="confirm"]','New-password2!') }
    await fill(); await h.input('[name="confirm"]','Different-password3!'); await h.submit('[data-password-form]')
    assert.match(h.document.body.textContent,/不一致/); assert.equal(calls.length,0)
    await h.input('[name="confirm"]','New-password2!'); await h.click('[type="checkbox"]'); await h.input('[name="code"]','aaaaaaaa-bbbbbbbb-cccccccc-dddddddd')
    await h.submit('[data-password-form]')
    assert.equal(done,0); assert.equal(h.require('[name="oldPassword"]').value,''); assert.equal(h.require('[name="code"]').value,'')
    assert.doesNotMatch(h.document.body.textContent,/internal-secret/)
    reject=false; await fill(); await h.input('[name="code"]','aaaaaaaa-bbbbbbbb-cccccccc-dddddddd'); await h.submit('[data-password-form]')
    assert.equal(done,1); assert.equal(h.query('[data-password-form]'),null)
    const mutation=calls.filter(x=>x.url.endsWith('/change'))
    assert.equal(mutation.length,2); assert.equal(mutation[1].init.headers['X-CSRF-Token'],'test-token')
    assert.equal(JSON.parse(mutation[1].init.body).recovery,true)
  },{fetch:async(url,init)=>{ calls.push({url,init}); return url.includes('csrf-token')?reply(200,{csrfToken:'test-token'}):reply(reject?401:200,reject?{message:'internal-secret'}:{success:true}) }})
})
it('重置页面只读fragment并即时清除，不自动请求或挂载播放器，成功清空表单不自动登录',async()=>{
  const calls=[]
  await withReactHarness(async h=>{
    const token='a'.repeat(43)
    h.window.history.replaceState(null,'',`/reset-password#token=${token}`)
    const { App }=await import('../frontend/src/app/App.tsx')
    await h.render(h.React.createElement(App))
    assert.equal(h.window.location.hash,''); assert.equal(calls.length,0)
    assert.equal(h.query('[data-album-archive]'),null); assert.equal(h.query('[name="oldPassword"]'),null)
    await h.input('[name="newPassword"]','Reset-password3!'); await h.input('[name="confirm"]','Reset-password3!')
    await h.submit('[data-password-form]')
    assert.match(h.document.body.textContent,/密码已更新/)
    assert.equal(h.window.location.pathname,'/reset-password'); assert.equal(h.query('[data-password-form]'),null)
    assert.equal(JSON.parse(calls.at(-1).init.body).token,token)
    assert.equal(h.window.localStorage.length,0)
    assert.deepEqual(calls.map(c=>c.url),['/api/security/csrf-token','/api/auth/password/reset'])
  },{fetch:async(url,init)=>{calls.push({url,init});return reply(200,url.includes('csrf-token')?{csrfToken:'test-token'}:{success:true})}})
})
it('缺失重置凭证不显示密码输入；登录页忘记密码与申请互斥并恢复焦点',async()=>{
  await withReactHarness(async h=>{
    const { LoginPage }=await import('../frontend/src/features/auth/LoginPage.tsx')
    await h.render(h.React.createElement(LoginPage))
    await h.click('[data-forgot-password-open]')
    assert.ok(h.query('[data-forgot-password-dialog]'))
    assert.equal(h.require('[data-application-open]').disabled,true)
    await h.input('[data-forgot-password-form] [name="email"]','unknown@example.com')
    await h.submit('[data-forgot-password-form]')
    assert.match(h.require('[data-forgot-password-dialog]').textContent,/如果该邮箱对应可用账号/)
    await h.click('[aria-label="关闭密码找回"]')
    assert.equal(h.query('[data-forgot-password-dialog]'),null)
    assert.equal(h.document.activeElement,h.require('[data-forgot-password-open]'))
    const { ResetPasswordPage }=await import('../frontend/src/features/auth/ResetPasswordPage.tsx')
    await h.render(h.React.createElement(ResetPasswordPage))
    assert.match(h.document.body.textContent,/重置链接缺失或已清除/); assert.equal(h.query('[data-password-form]'),null)
  },{fetch:async url=>reply(200,url.includes('csrf-token')?{csrfToken:'test-token'}:{success:true})})
})
it('卸载终止在途密码请求，迟到响应不触发成功回调',async()=>{
  let release,signal,done=0
  await withReactHarness(async h=>{
    const { PasswordForm }=await import('../frontend/src/features/auth/PasswordForm.tsx')
    await h.render(h.React.createElement(PasswordForm,{mode:'reset',token:'a'.repeat(43),onComplete:()=>done++}))
    await h.input('[name="newPassword"]','Reset-password3!');await h.input('[name="confirm"]','Reset-password3!');await h.submit('[data-password-form]')
    assert.ok(signal);assert.equal(signal.aborted,false)
    await h.unmount();assert.equal(signal.aborted,true)
    release(reply(200,{success:true}));await h.flush();assert.equal(done,0)
  },{fetch:async(url,init)=>url.includes('csrf-token')?reply(200,{csrfToken:'test-token'}):(signal=init.signal,new Promise(resolve=>{release=resolve}))})
})

it('代理返回非JSON时CSRF与结果解析均使用固定提示，不回显内部正文',async()=>{
  const { passwordRequest }=await import('../frontend/src/services/auth/password.ts')
  for(const phase of ['csrf','result']) {
    await withReactHarness(async()=>{
      await assert.rejects(()=>passwordRequest('forgot',{email:'a@example.com'},new AbortController().signal),error=>{
        assert.equal(error.message,'服务响应暂时不可用，请稍后重试')
        assert.doesNotMatch(error.message,/private|internal|SECRET/)
        return true
      })
    },{fetch:async url=>phase==='csrf' || !url.includes('csrf-token')
      ? {ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token /private/internal SECRET=value')}}
      : reply(200,{csrfToken:'test-token'})})
  }
})

it('重置完成后同标签重新打开fragment链接会清除URL并重建表单，不复用完成状态',async()=>{
  const tokens=[]
  await withReactHarness(async h=>{
    h.window.history.replaceState(null,'','/reset-password#token='+ 'a'.repeat(43))
    const { ResetPasswordPage }=await import('../frontend/src/features/auth/ResetPasswordPage.tsx')
    await h.render(h.React.createElement(ResetPasswordPage))
    const submit=async()=>{await h.input('[name="newPassword"]','Reset-password3!');await h.input('[name="confirm"]','Reset-password3!');await h.submit('[data-password-form]')}
    await submit();assert.equal(h.query('[data-password-form]'),null)
    await h.React.act(async()=>{
      h.window.history.pushState(null,'','/reset-password#token='+ 'b'.repeat(43))
      h.window.dispatchEvent(new h.window.PopStateEvent('popstate'))
    })
    await h.flush();assert.equal(h.window.location.hash,'');assert.ok(h.query('[data-password-form]'))
    await submit();assert.deepEqual(tokens,['a'.repeat(43),'b'.repeat(43)])
    await h.React.act(async()=>{
      h.window.history.pushState(null,'','/activate#token='+ 'c'.repeat(43))
      h.window.dispatchEvent(new h.window.PopStateEvent('popstate'))
    })
    assert.equal(h.window.location.hash,'#token='+ 'c'.repeat(43),'离开重置页不能清除其他邮件页面的凭证')
  },{fetch:async(url,init)=>{if(url.includes('csrf-token'))return reply(200,{csrfToken:'test-token'});tokens.push(JSON.parse(init.body).token);return reply(200,{success:true})}})
})
