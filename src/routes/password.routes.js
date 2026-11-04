const express = require('express')
const { rateLimit } = require('express-rate-limit')
const { requireLogin, clearSessionCookie } = require('../middleware/requireLogin')
const { createPasswordService } = require('../services/password.service')
function createPasswordRouter(app, createStore) {
  const router = express.Router()
  const service = createPasswordService({ database: app.locals.database, factor: app.locals.twoFactor,
    mail: app.locals.mail, publicOrigin: app.locals.security.publicOrigin, logger: app.locals.security.logger })
  app.locals.password = service
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    ...(createStore ? { store: createStore('password') } : {}),
    handler: (req, res) => res.status(429).json({ success: false, message: '操作过于频繁，请稍后再试' }) }))
  const handle = operation => async (req, res, next) => {
    try { await operation(req, res, next) }
    catch (error) { if (error.passwordError) res.status(error.status).json({ success: false, message: error.message }); else next(error) }
  }
  router.post('/forgot', handle(async (req, res) => {
    const message = service.requestReset(req.body?.email)
    // 已知和未知账号均不等待 SMTP，使用相同的响应调度。
    await new Promise(resolve => setTimeout(resolve, 100))
    res.status(202).json({ success: true, message })
  }))
  for (const change of [false, true]) router.post(change ? '/change' : '/reset', ...(change ? [requireLogin] : []), handle(async (req, res, next) => {
    await service.update(req.body, change ? req.user : null)
    req.session.destroy(error => {
      if (error) return next(error)
      clearSessionCookie(req, res)
      res.json({ success: true, message: '密码已更新，请重新登录' })
    })
  }))
  return router
}
module.exports = { createPasswordRouter }
