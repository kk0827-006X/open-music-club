const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')

const TEST_PASSWORD = 'test-password'

describe('网易云 API 白名单', () => {
  let directory
  let app
  let database
  let memberAgent
  let adminAgent
  let calls
  let neteaseService

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-netease-'))
    calls = []
    neteaseService = {
      async call(moduleName, parameters) {
        calls.push({ moduleName, parameters })
        return { code: 200, moduleName, parameters }
      },
    }
    app = createApp({
      databasePath: path.join(directory, 'database.sqlite'),
      sessionDatabasePath: path.join(directory, 'sessions.sqlite'),
      sessionSecret: 'test-session-secret',
      neteaseService,
    })
    database = app.locals.database

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4)
    createUser(database, {
      email: 'member@example.com',
      nickname: '普通成员',
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })
    createUser(database, {
      email: 'admin@example.com',
      nickname: '管理员',
      passwordHash,
      role: 'admin',
      status: 'active',
      mustChangePassword: false,
    })

    memberAgent = request.agent(app)
    adminAgent = request.agent(app)
    await login(memberAgent, 'member@example.com')
    await login(adminAgent, 'admin@example.com')
  })

  afterEach(async () => {
    if (database?.open) database.close()
    if (app?.locals.sessionStore?.db?.open) {
      await new Promise((resolve) => app.locals.sessionStore.db.close(resolve))
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function login(agent, email) {
    return agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })
  }

  it('五个白名单接口都拒绝未登录访问', async () => {
    const paths = [
      '/api/netease/search?keywords=test',
      '/api/netease/song/detail?ids=1',
      '/api/netease/song/url/v1?id=1',
      '/api/netease/lyric?id=1',
      '/api/netease/playlist/detail?id=1',
    ]

    for (const routePath of paths) {
      const response = await request(app).get(routePath)
      assert.equal(response.status, 401)
    }
    assert.equal(calls.length, 0)
  })

  it('普通用户和管理员都可以访问网易云接口', async () => {
    const memberResponse = await memberAgent.get(
      '/api/netease/search?keywords=测试歌曲',
    )
    const adminResponse = await adminAgent.get('/api/netease/lyric?id=123')

    assert.equal(memberResponse.status, 200)
    assert.equal(adminResponse.status, 200)
    assert.deepEqual(
      calls.map((call) => call.moduleName),
      ['search', 'lyric'],
    )
  })

  it('五个接口映射到对应的白名单模块并原样返回上游 body', async () => {
    const routes = [
      ['/api/netease/search?keywords=歌曲', 'search'],
      ['/api/netease/song/detail?ids=1,2', 'songDetail'],
      ['/api/netease/song/url/v1?id=1&level=lossless', 'songUrlV1'],
      ['/api/netease/lyric?id=1', 'lyric'],
      ['/api/netease/playlist/detail?id=1', 'playlistDetail'],
    ]

    for (const [routePath, moduleName] of routes) {
      neteaseService.call = async (name, parameters) => {
        calls.push({ moduleName: name, parameters })
        return { code: 200, result: { source: moduleName } }
      }
      const response = await memberAgent.get(routePath)

      assert.equal(response.status, 200)
      assert.deepEqual(response.body, {
        code: 200,
        result: { source: moduleName },
      })
      assert.equal(calls.at(-1).moduleName, moduleName)
    }
  })

  it('所有必填参数缺失时返回 400', async () => {
    const paths = [
      '/api/netease/search',
      '/api/netease/song/detail',
      '/api/netease/song/url/v1',
      '/api/netease/lyric',
      '/api/netease/playlist/detail',
    ]

    for (const routePath of paths) {
      const response = await memberAgent.get(routePath)
      assert.equal(response.status, 400)
      assert.equal(response.body.success, false)
    }
    assert.equal(calls.length, 0)
  })

  it('拒绝非法 ids、id、分页和音质参数', async () => {
    const paths = [
      '/api/netease/search?keywords=test&limit=0',
      '/api/netease/search?keywords=test&offset=-1',
      '/api/netease/song/detail?ids=1,invalid',
      '/api/netease/song/url/v1?id=0',
      '/api/netease/song/url/v1?id=1&level=invalid',
      '/api/netease/lyric?id=1.5',
      '/api/netease/playlist/detail?id=abc',
    ]

    for (const routePath of paths) {
      assert.equal((await memberAgent.get(routePath)).status, 400)
    }
    assert.equal(calls.length, 0)
  })

  it('搜索固定为歌曲类型并只传递允许的参数', async () => {
    const response = await memberAgent.get(
      '/api/netease/search?keywords=%20hello%20&limit=20&offset=2&type=1000&unblock=true&proxy=http://example.com&crypto=api&cookie=secret',
    )

    assert.equal(response.status, 200)
    assert.deepEqual(calls[0], {
      moduleName: 'search',
      parameters: {
        keywords: 'hello',
        type: 1,
        limit: 20,
        offset: 2,
      },
    })
  })

  it('播放地址默认 standard 且不会传递解灰等危险参数', async () => {
    const response = await memberAgent.get(
      '/api/netease/song/url/v1?id=123&unblock=true&source=kuwo&proxy=http://example.com&domain=https://example.com&crypto=api&cookie=secret',
    )

    assert.equal(response.status, 200)
    assert.deepEqual(calls[0], {
      moduleName: 'songUrlV1',
      parameters: { id: '123', level: 'standard' },
    })
  })

  it('上游异常统一转换为不泄露细节的 502', async () => {
    neteaseService.call = async () => {
      throw new Error('包含敏感上游细节')
    }

    const response = await memberAgent.get('/api/netease/lyric?id=123')

    assert.equal(response.status, 502)
    assert.deepEqual(response.body, {
      success: false,
      message: '网易云服务暂时不可用',
    })
    assert.equal(JSON.stringify(response.body).includes('敏感'), false)
  })

  it('未白名单路径和错误请求方法返回 JSON 404', async () => {
    const unknown = await memberAgent.get('/api/netease/comment/music?id=1')
    const wrongMethod = await memberAgent.post('/api/netease/search').send({
      keywords: 'test',
    })

    for (const response of [unknown, wrongMethod]) {
      assert.equal(response.status, 404)
      assert.deepEqual(response.body, {
        success: false,
        message: '网易云接口不存在',
      })
    }
    assert.equal(calls.length, 0)
  })
})

describe('网易云服务适配器', () => {
  it('默认直接引用 vendor 原版 song_url_v1 模块', () => {
    const vendorSongUrlV1 = require('../vendor/api-enhanced/module/song_url_v1')
    const { DEFAULT_MODULES } = require('../src/services/netease.service')

    assert.equal(DEFAULT_MODULES.songUrlV1, vendorSongUrlV1)
  })

  it('把白名单参数交给模块并返回模块 body', async () => {
    const requestClient = async () => ({ status: 200, body: { code: 200 } })
    const moduleCalls = []
    const moduleFunction = async (parameters, receivedRequestClient) => {
      moduleCalls.push({ parameters, receivedRequestClient })
      return { status: 200, body: { code: 200, songs: [] } }
    }
    const { createNeteaseService } = require('../src/services/netease.service')
    const service = createNeteaseService({
      modules: { search: moduleFunction },
      requestClient,
    })

    const body = await service.call('search', {
      keywords: 'hello',
      type: 1,
      limit: 20,
      offset: 0,
    })

    assert.deepEqual(body, { code: 200, songs: [] })
    assert.deepEqual(moduleCalls, [
      {
        parameters: {
          keywords: 'hello',
          type: 1,
          limit: 20,
          offset: 0,
          cookie: {},
        },
        receivedRequestClient: requestClient,
      },
    ])
  })

  it('启动初始化调用 vendor generateConfig 并验证运行时产物', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'open-music-netease-runtime-'),
    )
    const calls = []
    const generateConfig = async () => {
      calls.push('generateConfig')
      fs.writeFileSync(path.join(directory, 'anonymous_token'), 'token', 'utf8')
      fs.writeFileSync(
        path.join(directory, 'xeapi_public_key'),
        JSON.stringify({ sk: 'public-key', deviceId: 'runtime-device' }),
        'utf8',
      )
    }

    try {
      const { initializeNeteaseRuntime } = require('../src/services/netease.service')
      const runtimeCredentials = await initializeNeteaseRuntime({
        generateConfig,
        tempDirectory: directory,
      })

      assert.deepEqual(calls, ['generateConfig'])
      assert.deepEqual(runtimeCredentials, {
        anonymousToken: 'token',
        deviceId: 'runtime-device',
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('匿名 token 为空时有限重试并记录 warning，但不阻止启动', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'open-music-netease-runtime-'),
    )
    const calls = []
    const warnings = []

    try {
      const { initializeNeteaseRuntime } = require('../src/services/netease.service')
      await initializeNeteaseRuntime({
        generateConfig: async () => {
          calls.push('generateConfig')
          fs.writeFileSync(path.join(directory, 'anonymous_token'), '', 'utf8')
          fs.writeFileSync(
            path.join(directory, 'xeapi_public_key'),
            JSON.stringify({ sk: 'public-key', deviceId: 'runtime-device' }),
            'utf8',
          )
        },
        tempDirectory: directory,
        logger: {
          warn(message) {
            warnings.push(message)
          },
        },
      })

      assert.equal(calls.length, 2)
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /匿名 token.*为空/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('把初始化后的匿名身份注入 vendor，且客户端参数不能覆盖', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'open-music-netease-runtime-'),
    )
    const moduleCalls = []

    try {
      const {
        createNeteaseService,
        initializeNeteaseRuntime,
      } = require('../src/services/netease.service')
      const runtimeCredentials = await initializeNeteaseRuntime({
        generateConfig: async () => {
          fs.writeFileSync(
            path.join(directory, 'anonymous_token'),
            'server-anonymous-token',
            'utf8',
          )
          fs.writeFileSync(
            path.join(directory, 'xeapi_public_key'),
            JSON.stringify({ sk: 'public-key', deviceId: 'server-device' }),
            'utf8',
          )
        },
        tempDirectory: directory,
      })
      const service = createNeteaseService({
        runtimeCredentials,
        modules: {
          songUrlV1: async (parameters) => {
            moduleCalls.push(parameters)
            return { status: 200, body: { code: 200, data: [] } }
          },
        },
        requestClient: async () => {},
      })

      await service.call('songUrlV1', {
        id: '1',
        level: 'standard',
        cookie: { MUSIC_A: 'client-token', deviceId: 'client-device' },
      })

      assert.deepEqual(moduleCalls, [
        {
          id: '1',
          level: 'standard',
          cookie: {
            MUSIC_A: 'server-anonymous-token',
            deviceId: 'server-device',
          },
        },
      ])
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('generateConfig 失败后只重试一次并可恢复', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'open-music-netease-runtime-'),
    )
    let attempts = 0

    try {
      const { initializeNeteaseRuntime } = require('../src/services/netease.service')
      await initializeNeteaseRuntime({
        generateConfig: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('临时初始化错误')
          fs.writeFileSync(
            path.join(directory, 'anonymous_token'),
            'token',
            'utf8',
          )
          fs.writeFileSync(
            path.join(directory, 'xeapi_public_key'),
            JSON.stringify({ sk: 'public-key' }),
            'utf8',
          )
        },
        tempDirectory: directory,
      })

      assert.equal(attempts, 2)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('两次初始化后仍缺少 XEAPI public key 时失败', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'open-music-netease-runtime-'),
    )
    let attempts = 0

    try {
      const { initializeNeteaseRuntime } = require('../src/services/netease.service')
      await assert.rejects(
        initializeNeteaseRuntime({
          generateConfig: async () => {
            attempts += 1
          },
          tempDirectory: directory,
        }),
        /网易云运行时初始化失败/,
      )
      assert.equal(attempts, 2)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('播放地址失败响应不缓存，下一次调用会重新请求上游', async () => {
    const failureResponses = [
      { status: 200, body: { code: 200, data: [{ id: 1, url: null }] } },
      { status: 403, body: { code: 403, message: 'forbidden' } },
      { status: 200, body: { code: 460, message: 'risk control' } },
    ]
    const { createNeteaseService } = require('../src/services/netease.service')

    for (const failureResponse of failureResponses) {
      let calls = 0
      const service = createNeteaseService({
        modules: {
          songUrlV1: async () => {
            calls += 1
            if (calls === 1) return failureResponse
            return {
              status: 200,
              body: { code: 200, data: [{ id: 1, url: 'https://music.test/1' }] },
            }
          },
        },
        requestClient: async () => {},
      })

      await service.call('songUrlV1', { id: '1', level: 'standard' })
      const secondResponse = await service.call('songUrlV1', {
        id: '1',
        level: 'standard',
      })

      assert.equal(calls, 2)
      assert.equal(secondResponse.data[0].url, 'https://music.test/1')
    }
  })

  it('初始化失败后服务拒绝调用 vendor 模块', async () => {
    let moduleCalled = false
    const { createNeteaseService } = require('../src/services/netease.service')
    const service = createNeteaseService({
      initializationError: new Error('初始化失败细节'),
      modules: {
        search: async () => {
          moduleCalled = true
          return { status: 200, body: { code: 200 } }
        },
      },
      requestClient: async () => {},
    })

    await assert.rejects(service.call('search', { keywords: 'test' }))
    assert.equal(moduleCalled, false)
  })
})
