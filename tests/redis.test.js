const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { describe, it } = require('node:test')

const {
  createRedisInfrastructure,
  validateRedisUrl,
} = require('../src/config/redis')

class FakeRedisClient extends EventEmitter {
  constructor() {
    super()
    this.isOpen = false
    this.connectCalls = 0
    this.pingCalls = 0
    this.quitCalls = 0
  }

  async connect() {
    this.connectCalls += 1
    this.isOpen = true
  }

  async ping() {
    this.pingCalls += 1
    return 'PONG'
  }

  async quit() {
    this.quitCalls += 1
    this.isOpen = false
  }

  async sendCommand() {
    return null
  }
}

describe('Redis 运行时基础设施', () => {
  it('生产环境只允许回环地址的 redis 或 rediss URL', () => {
    assert.equal(
      validateRedisUrl('redis://127.0.0.1:6379', { production: true }),
      'redis://127.0.0.1:6379',
    )
    assert.equal(
      validateRedisUrl('rediss://localhost:6380/1', { production: true }),
      'rediss://localhost:6380/1',
    )
    assert.throws(
      () => validateRedisUrl('', { production: true }),
      /REDIS_URL/,
    )
    assert.throws(
      () => validateRedisUrl('http://127.0.0.1:6379', { production: true }),
      /redis:\/\/|rediss:\/\//,
    )
    assert.throws(
      () => validateRedisUrl('redis://redis.example.com:6379', { production: true }),
      /回环地址/,
    )
  })

  it('连接并探测 Redis，为 Session 和不同限流器创建独立命名空间', async () => {
    const client = new FakeRedisClient()
    const sessionStores = []
    const rateStores = []
    const infrastructure = await createRedisInfrastructure({
      redisUrl: 'redis://127.0.0.1:6379',
      production: true,
      clientFactory: () => client,
      sessionStoreFactory(options) {
        sessionStores.push(options)
        return { kind: 'session', ...options }
      },
      rateLimitStoreFactory(options) {
        rateStores.push(options)
        return { kind: 'rate-limit', ...options }
      },
      logger: { error() {} },
    })

    assert.equal(client.connectCalls, 1)
    assert.equal(client.pingCalls, 1)
    assert.equal(infrastructure.sessionStore.kind, 'session')
    assert.equal(sessionStores[0].prefix, 'omc:session:')

    const loginStore = infrastructure.createRateLimitStore('login')
    const globalStore = infrastructure.createRateLimitStore('global')
    assert.notEqual(loginStore, globalStore)
    assert.deepEqual(
      rateStores.map((options) => options.prefix),
      ['omc:rate:login:', 'omc:rate:global:'],
    )

    await infrastructure.close()
    assert.equal(client.quitCalls, 1)
  })

  it('Redis 探测失败时关闭连接并拒绝启动', async () => {
    const client = new FakeRedisClient()
    client.ping = async () => {
      throw new Error('内部连接细节')
    }

    await assert.rejects(
      createRedisInfrastructure({
        redisUrl: 'redis://127.0.0.1:6379',
        production: true,
        clientFactory: () => client,
        sessionStoreFactory: () => ({}),
        rateLimitStoreFactory: () => ({}),
        logger: { error() {} },
      }),
      /Redis 初始化失败/,
    )
    assert.equal(client.quitCalls, 1)
  })
})
