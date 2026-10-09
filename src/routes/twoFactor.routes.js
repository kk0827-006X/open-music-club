const express = require('express')
const bcrypt = require('bcrypt')
const QRCode = require('qrcode')
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const { findUserById } = require('../db/users')
const { requireLogin } = require('../middleware/requireLogin')
const { completeLogin } = require('./auth.routes')
const { requiredFor } = require('../services/twoFactor.service')

function createTwoFactorRouter(createStore) {
  const router = express.Router()
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // 公网使用现有 Redis Store；本地也保留独立的 IP 防暴力尝试限制。
  router.use(rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => ipKeyGenerator(req.ip), ...(createStore ? { store: createStore('twoFactor') } : {}),
    skip: req => req.method === 'GET', handler: (req, res) => res.status(429).json({ success: false, message: '尝试过于频繁，请稍后再试' }),
  }))
  const reject = (res, status = 401, message = '验证失败或已过期，请重试') => res.status(status).json({ success: false, message })
  function pending(req) {
    const challenge = req.session?.pendingTwoFactor, service = req.app.locals.twoFactor
    if (!challenge || challenge.expiresAt <= service.now()) return null
    const user = findUserById(req.app.locals.database, challenge.userId)
    if (!user || user.status !== 'active' || (service.state(user.id)?.session_version || 0) !== challenge.version) return null
    return { user, challenge }
  }
  function identity(req, res, next) {
    const challenge = pending(req)
    if (!req.session?.userId && challenge?.challenge.enrollment) { req.user = challenge.user; return next() }
    return requireLogin(req, res, next)
  }
  function audit(req, event) { req.app.locals.security.logger.info?.({ event, userId: req.user?.id, requestId: req.requestId }) }
  async function password(req, res) {
    const service = req.app.locals.twoFactor
    if (!service.checkUnlocked(req.user.id)) { reject(res, 429, '尝试过于频繁，请稍后再试'); return false }
    if (typeof req.body?.password !== 'string' || !(await bcrypt.compare(req.body.password, req.user.password_hash))) {
      service.fail(req.user.id); reject(res); return false
    }
    return true
  }
  router.get('/status', identity, (req, res) => {
    const service = req.app.locals.twoFactor, state = service.state(req.user.id)
    const remaining = req.app.locals.database.prepare('SELECT count(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND used_at IS NULL').get(req.user.id).count
    res.json({ success: true, available: service.available, enabled: state?.enabled === 1, required: requiredFor(req.app.locals.security, req.user), canDisable: req.user.role !== 'admin', recoveryCodesRemaining: remaining })
  })
  router.post('/setup', identity, async (req, res, next) => {
    try {
      const service = req.app.locals.twoFactor
      if (!service.available) return reject(res, 503, '两步验证暂未配置，请联系管理员')
      if (service.state(req.user.id)?.enabled) return reject(res, 409, '两步验证已启用')
      if (!(await password(req, res))) return
      const setup = service.setup(req.user, req.sessionID)
      const qrCode = await QRCode.toDataURL(setup.otpauthUrl)
      return res.json({ success: true, ...setup, qrCode })
    } catch (error) { next(error) }
  })
  router.post('/confirm', identity, (req, res, next) => {
    try {
      const service = req.app.locals.twoFactor
      if (!service.checkUnlocked(req.user.id)) return reject(res, 429, '尝试过于频繁，请稍后再试')
      const codes = service.confirm(req.user.id, req.sessionID, req.body?.code)
      if (!codes) { service.fail(req.user.id); return reject(res) }
      audit(req, 'two_factor_enabled')
      return completeLogin(req, res, next, req.user, req.session.pendingTwoFactor?.rememberMe, { recoveryCodes: codes })
    } catch (error) { next(error) }
  })
  for (const recovery of [false, true]) router.post(recovery ? '/recovery' : '/verify', (req, res, next) => {
    try {
      const entry = pending(req), service = req.app.locals.twoFactor
      if (!entry || entry.challenge.enrollment) return reject(res)
      if (!service.checkUnlocked(entry.user.id)) return reject(res, 429, '尝试过于频繁，请稍后再试')
      if (!service.consume(entry.user.id, req.body?.code, recovery)) { service.fail(entry.user.id); return reject(res) }
      req.user = entry.user
      audit(req, recovery ? 'two_factor_recovery_login' : 'two_factor_login')
      return completeLogin(req, res, next, entry.user, entry.challenge.rememberMe, { usedRecoveryCode: recovery })
    } catch (error) { next(error) }
  })
  for (const disable of [false, true]) router.post(disable ? '/disable' : '/recovery-codes/regenerate', requireLogin, async (req, res, next) => {
    try {
      if (disable && req.user.role === 'admin') return reject(res, 403, '管理员不能自行关闭两步验证')
      if (!(await password(req, res))) return
      const service = req.app.locals.twoFactor, codes = service.change(req.user.id, req.body?.code, disable)
      if (!codes) { service.fail(req.user.id); return reject(res) }
      audit(req, disable ? 'two_factor_disabled' : 'two_factor_recovery_regenerated')
      return completeLogin(req, res, next, req.user, false, disable ? {} : { recoveryCodes: codes })
    } catch (error) { next(error) }
  })
  return router
}
module.exports = { createTwoFactorRouter }
