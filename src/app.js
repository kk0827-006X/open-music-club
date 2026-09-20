const express = require('express')
const helmet = require('helmet')
const { createDatabase, initializeSchema } = require('./db/database')
const {
  createMemorySessionStore,
  createSessionMiddleware,
} = require('./config/session')
const { createSecurityConfig } = require('./config/security')
const { requireLogin } = require('./middleware/requireLogin')
const { requireAdmin } = require('./middleware/requireAdmin')
const { createAuthRouter } = require('./routes/auth.routes')
const { createApplicationsRouter } = require('./routes/applications.routes')
const {
  createAdminApplicationsRouter,
} = require('./routes/adminApplications.routes')
const { createNeteaseRouter } = require('./routes/netease.routes')
const { createNeteaseService } = require('./services/netease.service')
const { createLocalMusicConfig } = require('./config/localMusic')
const { createLocalMusicRouter } = require('./routes/localMusic.routes')
const {
  createCsrfProtection,
  createHttpsEnforcement,
  createRateLimiters,
  createSameOriginCors,
  csrfTokenHandler,
  requestIdMiddleware,
} = require('./middleware/security')

function createApp({
  databasePath,
  sessionSecret,
  neteaseService = createNeteaseService(),
  localMusic = {},
  security = {},
  infrastructure = {},
}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET 不能为空')
  }

  const securityConfig = createSecurityConfig(security)
  const sessionStore =
    infrastructure.sessionStore ||
    (securityConfig.production ? null : createMemorySessionStore())
  if (!sessionStore) {
    throw new Error('生产环境必须配置 Redis Session Store')
  }
  if (
    securityConfig.rateLimitEnabled &&
    securityConfig.production &&
    typeof infrastructure.createRateLimitStore !== 'function'
  ) {
    throw new Error('生产环境必须配置 Redis 限流 Store')
  }
  const localMusicConfig = createLocalMusicConfig(localMusic)
  const database = createDatabase(databasePath)
  initializeSchema(database)

  let sessionConfiguration
  try {
    sessionConfiguration = createSessionMiddleware({
      sessionSecret,
      store: sessionStore,
      cookieName: securityConfig.cookieName,
      secureCookies: securityConfig.secureCookies,
      sessionIdleTimeoutMinutes: securityConfig.sessionIdleTimeoutMinutes,
    })
  } catch (error) {
    database.close()
    throw error
  }

  const app = express()
  app.disable('x-powered-by')
  if (securityConfig.production) {
    app.set('trust proxy', securityConfig.trustProxyHops)
  }
  app.locals.database = database
  app.locals.sessionStore = sessionConfiguration.store
  app.locals.sessionCookieName = sessionConfiguration.cookieName
  app.locals.sessionCookieOptions = sessionConfiguration.cookieOptions
  app.locals.security = securityConfig

  app.use(requestIdMiddleware)
  app.use(createHttpsEnforcement(securityConfig))
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      hsts: securityConfig.production
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  )
  app.use(createSameOriginCors(securityConfig))
  app.use(express.json({ limit: securityConfig.jsonBodyLimit }))
  app.use(sessionConfiguration.middleware)

  const rateLimiters = createRateLimiters(
    securityConfig,
    infrastructure.createRateLimitStore,
  )
  if (rateLimiters) app.use(rateLimiters.global)

  app.get('/api/security/csrf-token', csrfTokenHandler)
  app.use(createCsrfProtection(securityConfig))

  app.get('/health', (req, res) => res.json({ status: 'ok' }))
  if (rateLimiters) app.use('/api/auth/login', rateLimiters.login)
  app.use('/api/auth', createAuthRouter())
  if (rateLimiters) app.use('/api/applications', rateLimiters.applications)
  app.use('/api/applications', createApplicationsRouter())
  app.use(
    '/api/admin/applications',
    requireLogin,
    requireAdmin,
    createAdminApplicationsRouter(),
  )
  if (rateLimiters) app.use('/api/netease', rateLimiters.netease)
  app.use('/api/netease', requireLogin, createNeteaseRouter(neteaseService))
  if (rateLimiters) {
    app.post('/api/local/music', rateLimiters.upload)
    app.get('/api/local/music/:id/download', rateLimiters.download)
  }
  app.use(
    '/api/local/music',
    requireLogin,
    createLocalMusicRouter({
      database,
      config: localMusicConfig,
      metadataReader: localMusic.metadataReader,
    }),
  )

  app.get('/api/protected', requireLogin, (req, res) => {
    res.json({ success: true, user: req.safeUser })
  })

  app.get('/api/admin/test', requireLogin, requireAdmin, (req, res) => {
    res.json({ success: true, user: req.safeUser })
  })

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: '接口不存在',
      requestId: req.requestId,
    })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const payloadTooLarge =
      error?.type === 'entity.too.large' || error?.status === 413
    const status = payloadTooLarge ? 413 : 500
    securityConfig.logger.error({
      event: 'request_failed',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status,
      errorName: error?.name,
    })
    return res.status(status).json({
      success: false,
      message: payloadTooLarge ? '请求内容过大' : '服务器内部错误',
      requestId: req.requestId,
    })
  })

  return app
}

module.exports = {
  createApp,
}
