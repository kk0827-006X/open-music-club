const dotenv = require('dotenv')
const http = require('node:http')
const { createApp } = require('./app')
const { createRedisInfrastructure } = require('./config/redis')
const {
  createNeteaseService,
  initializeNeteaseRuntime,
} = require('./services/netease.service')
const { parsePositiveInteger } = require('./config/security')

dotenv.config({ quiet: true })

async function start() {
  const databasePath =
    process.env.DATABASE_PATH || './data/open-music-club.sqlite'
  const port = parsePositiveInteger(process.env.PORT, 'PORT', 3000)
  if (port > 65_535) throw new Error('PORT 不能大于 65535')
  const production = process.env.NODE_ENV === 'production'
  const host = process.env.HOST || (production ? '127.0.0.1' : '0.0.0.0')
  const requestTimeout = parsePositiveInteger(
    process.env.REQUEST_TIMEOUT_MS,
    'REQUEST_TIMEOUT_MS',
    30_000,
  )
  const headersTimeout = parsePositiveInteger(
    process.env.HEADERS_TIMEOUT_MS,
    'HEADERS_TIMEOUT_MS',
    10_000,
  )
  const keepAliveTimeout = parsePositiveInteger(
    process.env.KEEP_ALIVE_TIMEOUT_MS,
    'KEEP_ALIVE_TIMEOUT_MS',
    5_000,
  )
  if (headersTimeout <= keepAliveTimeout) {
    throw new Error('HEADERS_TIMEOUT_MS 必须大于 KEEP_ALIVE_TIMEOUT_MS')
  }

  const infrastructure = await createRedisInfrastructure({
    redisUrl: process.env.REDIS_URL,
    production,
  })

  let initializationError
  let runtimeCredentials
  try {
    runtimeCredentials = await initializeNeteaseRuntime()
  } catch (error) {
    initializationError = error
    console.error('网易云运行时初始化失败，相关接口将返回 502')
  }

  let app
  try {
    app = createApp({
      databasePath,
      sessionSecret: process.env.SESSION_SECRET,
      neteaseService: createNeteaseService({
        initializationError,
        runtimeCredentials,
      }),
      infrastructure,
      security: {
        production,
        publicOrigin: process.env.PUBLIC_ORIGIN,
        trustProxyHops: process.env.TRUST_PROXY_HOPS,
        sessionIdleTimeoutMinutes: process.env.SESSION_IDLE_TIMEOUT_MINUTES,
      },
    })
  } catch (error) {
    await infrastructure.close()
    throw error
  }
  app.locals.redisClient = infrastructure.client

  const server = http.createServer(app)
  server.requestTimeout = requestTimeout
  server.headersTimeout = headersTimeout
  server.keepAliveTimeout = keepAliveTimeout
  server.listen(port, host, () => {
    const visibleAddress = production
      ? process.env.PUBLIC_ORIGIN
      : `http://${host}:${port}`
    console.log(`Open Music Club 已启动：${visibleAddress}`)
  })
  server.on('close', () => {
    infrastructure.close().catch(() => {
      console.error('Redis 连接关闭失败')
    })
  })
  return server
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Open Music Club 启动失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { start }
