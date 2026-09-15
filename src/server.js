const dotenv = require('dotenv')
const { createApp } = require('./app')
const { getSessionDatabasePath } = require('./config/session')
const {
  createNeteaseService,
  initializeNeteaseRuntime,
} = require('./services/netease.service')

dotenv.config({ quiet: true })

async function start() {
  const databasePath =
    process.env.DATABASE_PATH || './data/open-music-club.sqlite'
  const port = Number(process.env.PORT || 3000)
  const host = process.env.HOST || '0.0.0.0'

  let initializationError
  let runtimeCredentials
  try {
    runtimeCredentials = await initializeNeteaseRuntime()
  } catch (error) {
    initializationError = error
    console.error('网易云运行时初始化失败，相关接口将返回 502')
  }

  const app = createApp({
    databasePath,
    sessionDatabasePath: getSessionDatabasePath(databasePath),
    sessionSecret: process.env.SESSION_SECRET,
    neteaseService: createNeteaseService({
      initializationError,
      runtimeCredentials,
    }),
  })

  return app.listen(port, host, () => {
    console.log(`Open Music Club 已启动：http://${host}:${port}`)
  })
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Open Music Club 启动失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { start }
