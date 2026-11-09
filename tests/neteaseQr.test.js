const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createDatabase, initializeSchema } = require('../src/db/database')
const { createNeteaseSessionStore } = require('../src/db/neteaseSession')
const { createNeteaseAuthConfig } = require('../src/config/netease')
const { createNeteaseService } = require('../src/services/netease.service')
const { createNeteaseQrService } = require('../src/services/neteaseQr.service')
const key = Buffer.alloc(32, 13).toString('base64')
const auth = { mode: 'qrcode', storage: 'encrypted', encryptionKey: key }
const cookie = ['MUSIC_U=isolated-qr-cookie; HttpOnly', '__csrf=isolated-csrf; Path=/']
async function fixture(run, overrides = {}) {
  const db = createDatabase(':memory:'); initializeSchema(db)
  let timestamp = 1800000000000, checks = 0
  const backend = createNeteaseService({ auth, requestClient: async () => {},
    modules: { search: async parameters => ({ body: { code: 200, hasIdentity: Boolean(parameters.cookie.MUSIC_U), cookie: parameters.cookie } }) },
    qrModules: { key: async () => ({ body: { data: { unikey: 'isolated-key' } } }), check: async () => { checks++; return { body: { code: 803 }, cookie } }, ...overrides },
  })
  const qr = createNeteaseQrService({ database: db, neteaseService: backend, auth, now: () => timestamp })
  await backend.initialize()
  try { await run({ db, backend, qr, checks: () => checks, advance: ms => { timestamp += ms } }) }
  finally { qr.close(); await backend.close(); db.close() }
}
it('扫码配置明确区分加密与内存模式，缺失或错误密钥不静默保存明文', () => {
  assert.deepEqual(createNeteaseAuthConfig({ NETEASE_AUTH_MODE: 'qrcode', NETEASE_SESSION_STORAGE: 'memory' }), { mode: 'qrcode', storage: 'memory' })
  assert.deepEqual(createNeteaseAuthConfig({ NETEASE_AUTH_MODE: 'qrcode', NETEASE_SESSION_ENCRYPTION_KEY: key }), auth)
  for (const env of [{}, { NETEASE_SESSION_STORAGE: 'plaintext' }, { NETEASE_SESSION_ENCRYPTION_KEY: 'invalid-secret' }]) {
    assert.throws(() => createNeteaseAuthConfig({ NETEASE_AUTH_MODE: 'qrcode', ...env }), error => { assert.doesNotMatch(error.message, /invalid-secret/); return true })
  }
})
it('加密保存可跨连接恢复，篡改及换密钥失败，内存模式清理旧行并不保存新Cookie', () => {
  const db = createDatabase(':memory:'); initializeSchema(db)
  try {
    const store = createNeteaseSessionStore(db, auth), value = { MUSIC_U: 'private-token', __csrf: 'private-csrf' }
    store.save(value)
    const row = db.prepare('SELECT * FROM netease_session').get()
    assert.doesNotMatch(row.ciphertext, /private-token|private-csrf/)
    assert.deepEqual(createNeteaseSessionStore(db, auth).load(), value)
    assert.throws(() => createNeteaseSessionStore(db, { ...auth, encryptionKey: Buffer.alloc(32, 14).toString('base64') }).load())
    db.prepare('UPDATE netease_session SET ciphertext=?').run(row.ciphertext.slice(0,-4)+'AAAA')
    assert.throws(() => store.load())
    const memory = createNeteaseSessionStore(db, { storage: 'memory' })
    memory.save(value); assert.equal(memory.load(), null)
    assert.equal(db.prepare('SELECT count(*) n FROM netease_session').get().n, 0)
  } finally { db.close() }
})
it('等待/确认/成功状态只返回状态，Cookie加密后用于全站请求，退出同时删除存储', async () => {
  const codes = [801,802,803]
  await fixture(async f => {
    await assert.rejects(f.backend.call('search', {}))
    const entry = await f.qr.start('session-one')
    assert.match(entry.qrImage, /^data:image\/png;base64,/)
    assert.equal(f.qr.status().connected, false)
    assert.equal((await f.qr.check('session-one', entry.ticket)).state, 'waiting')
    await assert.rejects(f.qr.check('session-one', entry.ticket), error => error.status === 429)
    f.advance(3000); assert.equal((await f.qr.check('session-one', entry.ticket)).state, 'confirming')
    f.advance(3000); assert.equal((await f.qr.check('session-one', entry.ticket)).state, 'connected')
    assert.equal(f.qr.status().connected, true)
    assert.deepEqual(await f.backend.call('search', {}), { code: 200, hasIdentity: true })
    assert.doesNotMatch(JSON.stringify(f.qr.status()), /isolated-qr-cookie|isolated-csrf|ciphertext/)
    assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 1)
    f.qr.logout(); assert.equal(f.qr.status().connected, false)
    assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 0)
    await assert.rejects(f.backend.call('search', {}))
  }, { check: async () => ({ body: { code: codes.shift() }, cookie }) })
})
it('二维码绑定Session、限制其他管理员争用；旧ticket、取消和过期均不能消费', async () => fixture(async f => {
  const entry = await f.qr.start('owner')
  await assert.rejects(f.qr.start('other'), error => error.status === 409)
  await assert.rejects(f.qr.check('other', entry.ticket), error => error.status === 403)
  f.qr.cancel('other', entry.ticket)
  const replacement = await f.qr.start('owner')
  await assert.rejects(f.qr.check('owner', entry.ticket), error => error.status === 403)
  f.qr.cancel('owner', entry.ticket)
  f.advance(180001)
  await assert.rejects(f.qr.check('owner', replacement.ticket), error => error.status === 410)
  assert.equal(f.checks(), 0)
  const pending = await f.qr.start('owner'); f.qr.cancel('owner', pending.ticket)
  await assert.rejects(f.qr.check('owner', pending.ticket), error => error.status === 410)
}))
it('并发轮询、退出、取消、关闭及授权撤销均阻断迟到成功，不保存Cookie', async () => {
  for (const action of ['logout','cancel','close','revoke']) {
    let release
    await fixture(async f => {
      const entry = await f.qr.start('owner')
      const pending = f.qr.check('owner', entry.ticket, async () => action !== 'revoke')
      await assert.rejects(f.qr.check('owner', entry.ticket), error => error.status === 429)
      if (action === 'logout') f.qr.logout()
      if (action === 'cancel') f.qr.cancel('owner', entry.ticket)
      if (action === 'close') f.qr.close()
      release({ body: { code: 803 }, cookie })
      await assert.rejects(pending)
      assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 0)
      assert.equal(f.qr.status().connected, false)
    }, { check: () => new Promise(resolve => { release = resolve }) })
  }
})
it('存储写失败不降级内存，损坏的持久登录态不放行，重新扫码可替换', async () => fixture(async f => {
  f.db.exec("CREATE TRIGGER fail_qr BEFORE INSERT ON netease_session BEGIN SELECT RAISE(ABORT,'private-path'); END")
  const entry = await f.qr.start('owner')
  await assert.rejects(f.qr.check('owner', entry.ticket), error => { assert.equal(error.status,502); assert.doesNotMatch(error.message,/private-path/); return true })
  assert.equal(f.qr.status().connected, false)
  f.db.exec('DROP TRIGGER fail_qr')
  f.db.prepare('INSERT INTO netease_session(id,ciphertext) VALUES(1,?)').run('bad-data')
  const other = createNeteaseService({ auth, requestClient: async () => {} })
  other.configureQrStore(createNeteaseSessionStore(f.db, auth)); await other.initialize()
  assert.equal(other.accountStatus().storageError, true); assert.equal(other.accountStatus().connected, false)
  other.logoutQr(); await other.close()
}))
it('扫码成功后的重建服务恢复加密Cookie，内存重建不恢复，失效业务码删除持久凭据', async () => fixture(async f => {
  const entry = await f.qr.start('owner'); await f.qr.check('owner', entry.ticket)
  const other = createNeteaseService({ auth, requestClient: async () => {}, modules: { search: async () => ({ body: { code: -462, message: 'private-secret' } }) } })
  other.configureQrStore(createNeteaseSessionStore(f.db, auth)); await other.initialize()
  assert.equal(other.accountStatus().connected,true)
  await assert.rejects(other.call('search',{}),error=>{assert.doesNotMatch(error.message,/private-secret/);return true})
  assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n,0)
  await other.close()
  const memoryAuth={mode:'qrcode',storage:'memory'}, memory=createNeteaseService({auth:memoryAuth,requestClient:async()=>{}})
  memory.configureQrStore(createNeteaseSessionStore(f.db,memoryAuth));await memory.initialize()
  assert.equal(memory.accountStatus().connected,false);await memory.close()
}))

it('实际SQLite关闭重开后仅加密模式可恢复，切到内存模式会删除旧持久行',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'omc-qr-store-')),file=path.join(directory,'data.sqlite')
  let db
  try{
    db=createDatabase(file);initializeSchema(db)
    createNeteaseSessionStore(db,auth).save({MUSIC_U:'persisted-private-cookie'});db.close()
    db=createDatabase(file);initializeSchema(db)
    assert.equal(createNeteaseSessionStore(db,auth).load().MUSIC_U,'persisted-private-cookie')
    const memory=createNeteaseSessionStore(db,{storage:'memory'});memory.save({MUSIC_U:'not-persisted'});db.close()
    db=createDatabase(file);initializeSchema(db)
    assert.equal(createNeteaseSessionStore(db,auth).load(),null)
  }finally{if(db?.open)db.close();fs.rmSync(directory,{recursive:true,force:true})}
})

it('账号切换后旧业务请求的成功或失效响应均丢弃，不清除新账号的内存和密文',async()=>{
  for(const result of ['success','failure','throw']){
    const db=createDatabase(':memory:');initializeSchema(db)
    let release
    const backend=createNeteaseService({auth,requestClient:async()=>{},modules:{search:async parameters=>{
      assert.equal(parameters.cookie.MUSIC_U,'account-A')
      return new Promise((resolve,reject)=>{release=()=>result==='throw'?reject(Object.assign(new Error('private'),{code:-462})):resolve({body:{code:result==='success'?200:-462,privateA:true}})})
    }}})
    const store=createNeteaseSessionStore(db,auth);backend.configureQrStore(store);await backend.initialize()
    try{
      backend.acceptQrCookies(['MUSIC_U=account-A'])
      const pending=backend.call('search',{})
      await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function')
      backend.acceptQrCookies(['MUSIC_U=account-B'])
      release();await assert.rejects(pending)
      assert.equal(backend.accountStatus().connected,true)
      assert.equal(store.load().MUSIC_U,'account-B')
    }finally{await backend.close();db.close()}
  }
})
