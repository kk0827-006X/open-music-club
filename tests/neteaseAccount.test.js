const { it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createNeteaseAuthConfig } = require('../src/config/netease')
const { createNeteaseService } = require('../src/services/netease.service')
const auth = { mode: 'phone', phone: '13800000000', password: 'isolated-only-secret', countrycode: '86' }
const cookieResponse = { status: 200, body: { code: 200, cookie: 'MUSIC_U=isolated-user-cookie' }, cookie: ['MUSIC_U=isolated-user-cookie; HttpOnly; Path=/', '__csrf=isolated-csrf; Path=/'] }

it('配置缺省匿名；手机号模式完整校验且错误不回显输入，密码不做trim', () => {
  assert.deepEqual(createNeteaseAuthConfig({}), { mode: 'anonymous' })
  assert.deepEqual(createNeteaseAuthConfig({ NETEASE_AUTH_MODE: 'phone', NETEASE_PHONE: auth.phone, NETEASE_PASSWORD: ' a # b ' }), { ...auth, password: ' a # b ' })
  for (const env of [ { NETEASE_AUTH_MODE: 'invalid-secret' }, { NETEASE_AUTH_MODE: 'phone' }, { NETEASE_AUTH_MODE: 'phone', NETEASE_PHONE: 'invalid-secret' },
    { NETEASE_AUTH_MODE: 'phone', NETEASE_PHONE: auth.phone, NETEASE_PASSWORD: 'bad-secret\n' },
    { NETEASE_AUTH_MODE: 'phone', NETEASE_PHONE: auth.phone, NETEASE_PASSWORD: auth.password, NETEASE_COUNTRY_CODE: 'invalid-secret' } ]) {
    assert.throws(() => createNeteaseAuthConfig(env), error => { assert.doesNotMatch(error.message, /isolated-only|invalid-secret|bad-secret/); return true })
  }
})

it('全站并发请求只登录一次，密码只交给私有登录模块，MUSIC_U不混用匿名凭据或回传浏览器', async () => {
  let logins = 0
  const requests = [], client = async () => {}
  const service = createNeteaseService({ auth, runtimeCredentials: { anonymousToken: 'anonymous', deviceId: 'runtime-device' }, requestClient: client,
    loginModule: async (parameters, received) => { logins++; assert.equal(received, client); assert.equal(parameters.password, auth.password); assert.equal(parameters.phone, auth.phone); await new Promise(resolve => setImmediate(resolve)); return cookieResponse },
    modules: { search: async parameters => { requests.push(parameters); return { status: 200, body: { code: 200, nested: { cookie: 'secret', MUSIC_U: 'secret', password: 'secret', songs: [] } } } } },
  })
  const responses = await Promise.all(Array.from({ length: 12 }, () => service.call('search', { keywords: 'test', cookie: 'attacker-cookie' })))
  assert.equal(logins, 1)
  assert.deepEqual(requests[0].cookie, { deviceId: 'runtime-device', MUSIC_U: 'isolated-user-cookie', __csrf: 'isolated-csrf' })
  assert.equal(requests[0].password, undefined)
  assert.deepEqual(responses[0], { code: 200, nested: { songs: [] } })
  assert.equal(JSON.stringify(responses).includes('secret'), false)
  await service.initialize(); assert.equal(logins, 1)
  await service.close(); await assert.rejects(service.call('search', {}))
})

it('登录失败或验证码要求只尝试一次，不静默降级为匿名、不转发错误正文', async () => {
  for (const response of [{ body: { code: 502, message: auth.password } }, { body: { code: 200 }, cookie: [] }, { body: { code: 200 }, cookie: ['MUSIC_U=; Max-Age=0'] }, { body: { code: 200 }, cookie: ['MUSIC_U=expired; Max-Age=0'] }]) {
    let logins = 0, calls = 0
    const service = createNeteaseService({ auth, requestClient: async () => {}, loginModule: async () => { logins++; return response }, modules: { search: async () => { calls++ } } })
    for (let i = 0; i < 2; i++) await assert.rejects(service.call('search', {}), error => { assert.doesNotMatch(error.message, /isolated-only|cookie|手机号/); return true })
    assert.equal(logins, 1); assert.equal(calls, 0)
  }
})

it('匿名模式不触发手机号登录；不向公网开放登录模块，运行时失败不尝试账号登录', async () => {
  let logins = 0
  const options = { loginModule: async () => { logins++; return cookieResponse }, requestClient: async () => {}, modules: { search: async parameters => ({ body: { code: 200, name: parameters.cookie.MUSIC_A } }) }, runtimeCredentials: { anonymousToken: 'anon' } }
  const service = createNeteaseService(options)
  assert.equal((await service.call('search', {})).name, 'anon')
  await assert.rejects(service.call('login', {}), /白名单/)
  await assert.rejects(createNeteaseService({ ...options, auth, initializationError: new Error('private-secret') }).call('search', {}))
  assert.equal(logins, 0)
})

it('登录会话失效或风控后阻止后续请求，不自动再次登录', async () => {
  for (const code of [301, 405, 460]) {
    for (const throws of [false, true]) {
      let calls = 0, logins = 0
      const service = createNeteaseService({ auth, requestClient: async () => {}, loginModule: async () => { logins++; return cookieResponse }, modules: {
        search: async () => { calls++; if (throws) throw Object.assign(new Error('private-secret'), { code }); return { body: { code, message: 'private-secret' } } },
      } })
      await assert.rejects(service.call('search', {}), error => { assert.doesNotMatch(error.message, /private-secret/); return true })
      await assert.rejects(service.call('search', {})); assert.equal(calls, 1); assert.equal(logins, 1)
    }
  }
})

it('私有请求线程不输出上游密码、Cookie或异常正文，固定超时并可关闭', () => {
  const entry = require.resolve('../src/services/netease-request')
  const requestModule = path.resolve(__dirname, 'fixtures/netease-private-request.js')
  const output = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict');
    const {createNeteaseRequestClient}=require(${JSON.stringify(entry)});
    (async()=>{
      const client=createNeteaseRequestClient({requestModule:${JSON.stringify(requestModule)}});
      const response=await client('ok',{test:true},{});assert.equal(response.body.timeout,10000);
      await assert.rejects(client('throw',{},{}),error=>{assert.equal(error.code,460);assert.equal(error.message,'网易云请求暂时不可用');return true});
      await client.close();await assert.rejects(client('ok',{},{}));
      const timed=createNeteaseRequestClient({requestModule:${JSON.stringify(requestModule)},timeoutMs:100});
      await Promise.all([assert.rejects(timed('hang',{},{})),assert.rejects(timed('hang',{},{}))]);
      await assert.rejects(timed('ok',{},{}));await timed.close();
      const exited=createNeteaseRequestClient({requestModule:${JSON.stringify(requestModule)}});
      await assert.rejects(exited('exit',{},{}));await exited.close();
    })().catch(()=>{process.exitCode=1});
  `], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(output.status, 0, output.stderr)
  assert.equal(output.stdout, '')
  assert.equal(output.stderr, '')
})


it('实际手机号模块只向私有请求客户端传递md5密码和weapi选项，不增加公开登录API',async()=>{
  const {createHash}=require('node:crypto')
  const calls=[]
  const service=createNeteaseService({auth,requestClient:async(uri,data,options)=>{calls.push({uri,data,options});return cookieResponse},modules:{search:async()=>({body:{code:200,songs:[]}})}})
  await service.initialize()
  assert.equal(calls.length,1)
  assert.equal(calls[0].uri,'/api/w/login/cellphone')
  assert.equal(calls[0].data.password,createHash('md5').update(auth.password).digest('hex'))
  assert.equal(calls[0].options.crypto,'weapi')
  assert.doesNotMatch(JSON.stringify(await service.call('search',{})),/isolated-user-cookie|isolated-only-secret/)
  await assert.rejects(service.call('login_cellphone',{}),/白名单/)
  await service.close()
})


it('关闭服务后异步续体不能调用模块或创建请求资源',async()=>{
  let calls=0
  const service=createNeteaseService({modules:{search:async()=>{calls++;return {body:{code:200}}}},requestClient:async()=>{calls++}})
  const pending=service.call('search',{})
  await service.close()
  await assert.rejects(pending)
  assert.equal(calls,0)
})
