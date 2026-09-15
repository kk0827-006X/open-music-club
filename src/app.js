const express = require('express')
const { createDatabase, initializeSchema } = require('./db/database')
const { createSessionMiddleware } = require('./config/session')
const { requireLogin } = require('./middleware/requireLogin')
const { requireAdmin } = require('./middleware/requireAdmin')
const { createAuthRouter } = require('./routes/auth.routes')
const { createApplicationsRouter } = require('./routes/applications.routes')
const {
  createAdminApplicationsRouter,
} = require('./routes/adminApplications.routes')

function createApp({ databasePath, sessionDatabasePath, sessionSecret }) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET 不能为空')
  }

  const database = createDatabase(databasePath)
  initializeSchema(database)

  let sessionConfiguration
  try {
    sessionConfiguration = createSessionMiddleware({
      sessionSecret,
      sessionDatabasePath,
    })
  } catch (error) {
    database.close()
    throw error
  }

  const app = express()
  app.locals.database = database
  app.locals.sessionStore = sessionConfiguration.store

  app.use(express.json())
  app.use(sessionConfiguration.middleware)

  app.get('/health', (req, res) => res.json({ status: 'ok' }))
  app.use('/api/auth', createAuthRouter())
  app.use('/api/applications', createApplicationsRouter())
  app.use(
    '/api/admin/applications',
    requireLogin,
    requireAdmin,
    createAdminApplicationsRouter(),
  )

  app.get('/api/protected', requireLogin, (req, res) => {
    res.json({ success: true, user: req.safeUser })
  })

  app.get('/api/admin/test', requireLogin, requireAdmin, (req, res) => {
    res.json({ success: true, user: req.safeUser })
  })

  app.use((error, req, res, next) => {
    console.error('请求处理失败：', error)
    if (res.headersSent) return next(error)
    return res.status(500).json({ success: false, message: '服务器内部错误' })
  })

  return app
}

module.exports = {
  createApp,
}
