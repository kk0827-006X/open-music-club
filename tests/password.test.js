const assert = require('node:assert/strict')
const { it } = require('node:test')
const request = require('supertest')
const bcrypt = require('bcrypt')
const { generateSync } = require('otplib')
const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')
const oldPassword = 'Old-password1!', newPassword = 'New-password2!'
async function fixture(run, options = {}) {
  const messages = [], logs = []
  const app = createApp({ databasePath: ':memory:', sessionSecret: 'isolated-password-tests',
    security: { publicOrigin: 'http://localhost', csrfEnabled: true, logger: { info: e => logs.push(e), warn: e => logs.push(e), error: e => logs.push(e) } },
    twoFactor: { encryptionKey: Buffer.alloc(32, 9).toString('base64'), ...options.twoFactor },
    mail: { env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com' },
      transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] } } }, ...options.mail },
  })
  const db = app.locals.database
  const user = createUser(db, { email: 'password@example.com', nickname: '隔离用户', passwordHash: await bcrypt.hash(oldPassword, 4), mustChangePassword: false })
  createUser(db, { email: 'disabled@example.com', nickname: '禁用用户', passwordHash: user.password_hash, status: 'disabled' })
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
  const agent = () => request.agent(server).timeout({ deadline: 15_000 })
  const post = async (client, path, body, csrfToken) => {
    if (csrfToken === undefined) {
      const csrf = await client.get('/api/security/csrf-token').expect(200)
      csrfToken = csrf.body.csrfToken
    }
    return client.post(path).set('Origin', 'http://localhost').set('X-CSRF-Token', csrfToken).send(body)
  }
  const login = async client => { assert.equal((await post(client, '/api/auth/login', { email: user.email, password: oldPassword })).status, 200) }
  const token = async client => {
    const response = await post(client, '/api/auth/password/forgot', { email: user.email })
    assert.equal(response.status, 202)
    await app.locals.password.drain()
    const url = messages.filter(m => m.subject.includes('重置密码')).at(-1)?.text.match(/http:\/\/localhost\/reset-password#token=([\w-]{43})/)
    assert.ok(url); return url[1]
  }
  try { await run({ app, db, user, messages, logs, agent, post, login, token }) }
  finally {
    try {
      await app.locals.password.drain()
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    } finally { app.locals.sessionStore.stopInterval?.(); db.close() }
  }
}

it('改密验证原密码，撤销全部旧会话及链接，新密码生效且不自动登录', async () => fixture(async f => {
  const a = f.agent(), b = f.agent(), anonymous = f.agent()
  await f.login(a); await f.login(b)
  const token = await f.token(anonymous)
  assert.equal((await f.post(a, '/api/auth/password/change', { oldPassword: 'wrong', newPassword })).status, 401)
  assert.equal((await b.get('/api/protected')).status, 200)
  const changed = await f.post(a, '/api/auth/password/change', { oldPassword, newPassword })
  assert.equal(changed.status, 200)
  assert.equal((await a.get('/api/protected')).status, 401)
  assert.equal((await b.get('/api/protected')).status, 401)
  assert.equal(f.db.prepare('SELECT count(*) n FROM password_reset_tokens').get().n, 0)
  assert.equal((await f.post(anonymous, '/api/auth/password/reset', { token, newPassword: 'Other-password3!' })).status, 400)
  assert.equal((await f.post(a, '/api/auth/login', { email: f.user.email, password: oldPassword })).status, 401)
  assert.equal((await f.post(a, '/api/auth/login', { email: f.user.email, password: newPassword })).status, 200)
  await f.app.locals.password.drain()
  assert.ok(f.messages.some(m => m.subject.includes('密码已更新')))
}))

it('邮件重置不要求旧密码，凭证仅存哈希，过期/非法/已消费和并发重放均拒绝', async () => fixture(async f => {
  const c = f.agent(), token = await f.token(c)
  const stored = f.db.prepare('SELECT * FROM password_reset_tokens').get()
  assert.equal(JSON.stringify(stored).includes(token), false)
  assert.ok(stored.expires_at - Date.now() <= 15 * 60000)
  assert.equal((await c.get(`/reset-password#token=${token}`)).status, 404)
  assert.ok(f.db.prepare('SELECT * FROM password_reset_tokens').get(), 'GET 不消费凭证')
  assert.equal((await f.post(c, '/api/auth/password/reset', { token: '../bad', newPassword })).status, 400)
  f.db.prepare('UPDATE password_reset_tokens SET expires_at=?').run(Date.now() - 1)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword })).status, 400)
  f.db.prepare('UPDATE password_reset_tokens SET expires_at=?').run(Date.now() + 60000)
  const [a, b] = await Promise.all([
    f.post(c, '/api/auth/password/reset', { token, newPassword }),
    f.post(f.agent(), '/api/auth/password/reset', { token, newPassword: 'Concurrent-password3!' }),
  ])
  assert.equal([a,b].filter(r => r.status === 200).length, 1)
  assert.ok([a,b].some(r => [400,409].includes(r.status)))
  assert.equal((await c.get('/api/protected')).status, 401)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword })).status, 400)
}))

it('已启用2FA的改密和重置均要求第二因子，恢复码原子消费并保留绑定', async () => fixture(async f => {
  const c = f.agent(), token = await f.token(c)
  const factor = f.app.locals.twoFactor
  const setup = factor.setup(f.user, 'isolated-session')
  const codes = factor.confirm(f.user.id, 'isolated-session', generateSync({ secret: setup.secret }))
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword, code: codes[0], recovery: true })).status, 400, '2FA 版本变化使旧链接失效')
  // 绑定后通过恢复码登录，后续改密必须再使用一组未消费的恢复码。
  await f.login(c)
  assert.equal((await f.post(c, '/api/auth/2fa/recovery', { code: codes[0] })).status, 200)
  assert.equal((await f.post(c, '/api/auth/password/change', { oldPassword, newPassword })).status, 401)
  assert.equal((await f.post(c, '/api/auth/password/change', { oldPassword, newPassword, code: codes[1], recovery: true })).status, 200)
  assert.equal(factor.state(f.user.id).enabled, 1)
  assert.equal(factor.consume(f.user.id, codes[1], true), false)
  // 新密码登录后新申请重置，不接受已用于登录/改密的恢复码。
  f.db.prepare('DELETE FROM password_reset_requests').run()
  const freshToken = await f.token(c)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token: freshToken, newPassword: oldPassword, code: codes[1], recovery: true })).status, 401)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token: freshToken, newPassword: oldPassword, code: codes[2], recovery: true })).status, 200)
  assert.equal(factor.state(f.user.id).enabled, 1)
  assert.equal(factor.consume(f.user.id, codes[2], true), false)
}))

it('TOTP 重放、五次失败锁定和数据库写入失败不会消耗恢复码或改变密码', async () => fixture(async f => {
  const c = f.agent(), factor = f.app.locals.twoFactor
  const setup = factor.setup(f.user, 's'), usedCode = generateSync({ secret: setup.secret })
  const codes = factor.confirm(f.user.id, 's', usedCode)
  const token = await f.token(c)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword, code: usedCode })).status, 401)
  f.db.exec(`CREATE TRIGGER fail_password_write BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT,'isolated-db-error'); END;`)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword, code: codes[0], recovery: true })).status, 500)
  assert.equal(f.db.prepare('SELECT used_at FROM two_factor_recovery_codes WHERE user_id=? ORDER BY id LIMIT 1').get(f.user.id).used_at, null)
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(f.user.id).password_hash, f.user.password_hash)
  f.db.exec('DROP TRIGGER fail_password_write')
  for (let i=0;i<4;i++) assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword, code: 'invalid' })).status, 401)
  assert.equal((await f.post(c, '/api/auth/password/reset', { token, newPassword, code: codes[0], recovery: true })).status, 400)
  assert.equal(factor.checkUnlocked(f.user.id), false)
}))

it('找回响应一致、按邮箱限制发信，禁用账号不发信，缺失配置不降级', async () => fixture(async f => {
  const c=f.agent(), known=await f.post(c,'/api/auth/password/forgot',{email:f.user.email})
  const unknown=await f.post(c,'/api/auth/password/forgot',{email:'unknown@example.com'})
  const disabled=await f.post(c,'/api/auth/password/forgot',{email:'disabled@example.com'})
  assert.deepEqual(known.body,unknown.body); assert.deepEqual(known.body,disabled.body)
  assert.deepEqual((await f.post(c,'/api/auth/password/forgot',{email:f.user.email})).body,known.body)
  await f.app.locals.password.drain()
  assert.equal(f.messages.length,1)
  assert.equal(JSON.stringify(f.logs).includes('token='),false)
  assert.equal((await c.post('/api/auth/password/forgot').send({email:f.user.email})).status,403)
  assert.equal((await f.post(c,'/api/auth/password/change',{oldPassword,newPassword})).status,401)
}))

it('新密码复用激活规则且不能使用原密码，原密码五次失败会锁定安全操作', async () => fixture(async f => {
  const c=f.agent(); await f.login(c)
  for(const password of ['short','abcdefgh','Ab1!'+ 'x'.repeat(69),'Abcdef1!中',oldPassword]) {
    assert.equal((await f.post(c,'/api/auth/password/change',{oldPassword,newPassword:password})).status,400)
  }
  for(let i=0;i<5;i++) assert.equal((await f.post(c,'/api/auth/password/change',{oldPassword:'wrong',newPassword})).status,401)
  assert.equal((await f.post(c,'/api/auth/password/change',{oldPassword,newPassword})).status,429)
}))

it('邮件服务未配置时，所有邮箱统一返回503且错误不含内部配置', async () => fixture(async f => {
  for(const email of [f.user.email,'unknown@example.com']) {
    const response=await f.post(f.agent(),'/api/auth/password/forgot',{email})
    assert.equal(response.status,503); assert.doesNotMatch(JSON.stringify(response.body),/SMTP|SECRET|stack|password_hash/)
  }
},{mail:{env:{MAIL_ENABLED:'false'}}}))


it('新的TOTP可完成密码重置，使用过的验证码不能再登录',async()=>{
  let timestamp=Date.now()
  await fixture(async f=>{
    const factor=f.app.locals.twoFactor, setup=factor.setup(f.user,'totp-test')
    factor.confirm(f.user.id,'totp-test',generateSync({secret:setup.secret,epoch:timestamp/1000}))
    timestamp+=30000
    const code=generateSync({secret:setup.secret,epoch:timestamp/1000}), client=f.agent(), token=await f.token(client)
    assert.equal((await f.post(client,'/api/auth/password/reset',{token,newPassword,code})).status,200)
    assert.equal((await f.post(client,'/api/auth/login',{email:f.user.email,password:newPassword})).body.requiresTwoFactor,true)
    assert.equal((await f.post(client,'/api/auth/2fa/verify',{code})).status,401)
  },{twoFactor:{now:()=>timestamp}})
})
it('登录轮换Session期间发生改密，旧密码的迟到登录不能取得新安全版本',async()=>fixture(async f=>{
  const store=f.app.locals.sessionStore, original=store.destroy.bind(store)
  let release,hold=true
  store.destroy=(id,callback)=>{if(hold){hold=false;release=()=>original(id,callback)}else original(id,callback)}
  const client=f.agent()
  const attempt=f.post(client,'/api/auth/login',{email:f.user.email,password:oldPassword})
  for(let i=0;!release && i<100;i++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(typeof release,'function')
  try { await f.app.locals.password.update({oldPassword,newPassword},f.user) }
  finally { release() }
  assert.equal((await attempt).status,401)
  assert.equal((await client.get('/api/protected')).status,401)
}))

it('已撤销的2FA关闭请求不能修改新安全状态，旧改密失败不能锁住新密码',async()=>{
  let timestamp=Date.now()
  await fixture(async f=>{
  const client=f.agent(), factor=f.app.locals.twoFactor
  const setup=factor.setup(f.user,'race-2fa')
  const codes=factor.confirm(f.user.id,'race-2fa',generateSync({secret:setup.secret,epoch:timestamp/1000}))
  timestamp+=30000
  // 关闭操作本身携带有效且未使用的验证码，必须由安全版本检查阻止迟到请求。
  const disableCode=generateSync({secret:setup.secret,epoch:timestamp/1000})
  await f.login(client)
  assert.equal((await f.post(client,'/api/auth/2fa/recovery',{code:codes[0]})).status,200)
  // 2FA 会轮换 Session；先为新会话创建一次 CSRF，再同时发送六个安全操作。
  // 否则并发 GET 可能各自生成 token，测试会先在 CSRF 层被拒绝，未进入密码比较。
  const csrf=await client.get('/api/security/csrf-token').expect(200)
  assert.equal(typeof csrf.body.csrfToken,'string')
  const original=bcrypt.compare
  const waiting=[]
  let disable, failures=[]
  bcrypt.compare=async(value,hash)=>{
    if(value===oldPassword || value==='wrong-race') await new Promise(resolve=>waiting.push(resolve))
    return original(value,hash)
  }
  try {
    disable=f.post(client,'/api/auth/2fa/disable',{password:oldPassword,code:disableCode},csrf.body.csrfToken)
    failures=Array.from({length:5},()=>f.post(client,'/api/auth/password/change',{oldPassword:'wrong-race',newPassword},csrf.body.csrfToken))
    for(let i=0;waiting.length<6 && i<200;i++) await new Promise(resolve=>setTimeout(resolve,10))
    assert.equal(waiting.length,6)
    f.db.prepare('DELETE FROM password_reset_requests').run()
    const token=await f.token(f.agent())
    await f.app.locals.password.update({token,newPassword,code:codes[1],recovery:true})
    waiting.forEach(resolve=>resolve())
    assert.equal((await disable).status,401)
    assert.deepEqual((await Promise.all(failures)).map(r=>r.status),[409,409,409,409,409])
    assert.equal(factor.state(f.user.id).enabled,1)
    assert.equal(factor.state(f.user.id).failed_attempts,0)
    assert.equal(factor.checkUnlocked(f.user.id),true)
  } finally {
    waiting.forEach(resolve=>resolve()); bcrypt.compare=original
    await Promise.allSettled([disable,...failures])
  }
  },{twoFactor:{now:()=>timestamp}})
})


it('既有超过72字节的管理员密码仍可验证原密码、绑定2FA并更换为新规则密码',async()=>fixture(async f=>{
  const legacy='Legacy-Aa1!'+ 'x'.repeat(80), client=f.agent()
  f.db.prepare("UPDATE users SET password_hash=?,role='admin' WHERE id=?").run(await bcrypt.hash(legacy,4),f.user.id)
  assert.equal((await f.post(client,'/api/auth/login',{email:f.user.email,password:legacy})).status,200)
  const setup=await f.post(client,'/api/auth/2fa/setup',{password:legacy})
  assert.equal(setup.status,200)
  const confirmation=await f.post(client,'/api/auth/2fa/confirm',{code:generateSync({secret:setup.body.secret})})
  assert.equal(confirmation.status,200)
  assert.equal((await f.post(client,'/api/auth/password/change',{oldPassword:legacy,newPassword,code:confirmation.body.recoveryCodes[0],recovery:true})).status,200)
  assert.equal(f.app.locals.twoFactor.state(f.user.id).enabled,1)
}))
