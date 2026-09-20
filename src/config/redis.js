const { createClient } = require('redis')
const { RedisStore: SessionRedisStore } = require('connect-redis')
const { RedisStore: RateLimitRedisStore } = require('rate-limit-redis')

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

function validateRedisUrl(value, { production = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('REDIS_URL 不能为空')
  }

  const normalized = value.trim()
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('REDIS_URL 必须是合法 URL')
  }

  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL 必须使用 redis:// 或 rediss://')
  }
  if (production && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('单机生产环境 REDIS_URL 必须使用回环地址')
  }
  return normalized
}

async function closeClient(client) {
  if (client?.isOpen) await client.quit()
}

async function createRedisInfrastructure({
  redisUrl,
  production = false,
  logger = console,
  clientFactory = createClient,
  sessionStoreFactory = (options) => new SessionRedisStore(options),
  rateLimitStoreFactory = (options) => new RateLimitRedisStore(options),
} = {}) {
  const url = validateRedisUrl(redisUrl, { production })
  const client = clientFactory({
    url,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy(retries) {
        if (retries >= 5) return new Error('Redis 重连次数已用尽')
        return Math.min(100 * 2 ** retries, 2_000)
      },
    },
  })

  client.on('error', () => {
    logger.error({ event: 'redis_connection_error' })
  })

  try {
    await client.connect()
    const pong = await client.ping()
    if (pong !== 'PONG') throw new Error('Redis PING 响应异常')
  } catch {
    await closeClient(client)
    throw new Error('Redis 初始化失败')
  }

  const sessionStore = sessionStoreFactory({
    client,
    prefix: 'omc:session:',
  })

  return {
    client,
    sessionStore,
    createRateLimitStore(scope) {
      return rateLimitStoreFactory({
        sendCommand: (...args) => client.sendCommand(args),
        prefix: `omc:rate:${scope}:`,
      })
    },
    async close() {
      await closeClient(client)
    },
  }
}

module.exports = {
  createRedisInfrastructure,
  validateRedisUrl,
}
