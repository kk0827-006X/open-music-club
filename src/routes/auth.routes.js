const express = require('express')
const bcrypt = require('bcrypt')
const { findUserByEmail, findUserById, toSafeUser } = require('../db/users')
const { clearSessionCookie } = require('../middleware/requireLogin')
const { REMEMBER_LOGIN_MAX_AGE_MS } = require('../config/session')
const { requiredFor, sessionIsValid } = require('../services/twoFactor.service')

function completeLogin(req, res, next, user, rememberMe, extra = {}) {
  const deadline = req.session.rememberUntil
  return req.session.regenerate((error) => {
    if (error) return next(error)
    req.session.userId = user.id
    req.session.role = user.role
    const factor = req.app.locals.twoFactor.state(user.id)
    req.session.twoFactorVersion = factor?.session_version || 0
    req.session.twoFactorVerified = factor?.enabled === 1
    if (rememberMe || deadline) {
      const security = req.app.locals.security
      const duration = deadline ? Math.max(1, deadline - Date.now()) : security.production && user.role === 'admin'
        ? Math.min(REMEMBER_LOGIN_MAX_AGE_MS, security.sessionIdleTimeoutMinutes * 60000) : REMEMBER_LOGIN_MAX_AGE_MS
      req.session.rememberUntil = deadline || Date.now() + duration
      req.session.cookie.maxAge = duration
    }
    req.session.save((saveError) => saveError ? next(saveError) : res.json({ success: true, user: toSafeUser(user), ...extra }))
  })
}

function destroySession(req, res, next, callback) {
  req.session.destroy((error) => {
    if (error) return next(error)
    clearSessionCookie(req, res)
    return callback()
  })
}

function createAuthRouter() {
  const router = express.Router()
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.post('/login', async (req, res, next) => {
    try {
      // 开始新登录尝试时撤销旧挑战，避免不同账号的待验证状态交叉。
      delete req.session.pendingTwoFactor
      const { email, password, rememberMe = false } = req.body || {}
      if (typeof rememberMe !== 'boolean') {
        return res.status(400).json({ success: false, message: '保持登录参数必须为布尔值' })
      }
      if (
        typeof email !== 'string' ||
        email.trim() === '' ||
        typeof password !== 'string' ||
        password === ''
      ) {
        return res
          .status(400)
          .json({ success: false, message: '邮箱和密码不能为空' })
      }

      const user = findUserByEmail(req.app.locals.database, email)
      if (!user) {
        return res
          .status(401)
          .json({ success: false, message: '邮箱或密码错误' })
      }
      if (user.status !== 'active') {
        return res.status(403).json({ success: false, message: '账号已被禁用' })
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash)
      if (!passwordMatches) {
        return res
          .status(401)
          .json({ success: false, message: '邮箱或密码错误' })
      }

      const factor = req.app.locals.twoFactor
      const state = factor.state(user.id)
      if (!factor.checkUnlocked(user.id)) return res.status(429).json({ success: false, message: '尝试过于频繁，请稍后再试' })
      if (!(state?.enabled || requiredFor(req.app.locals.security, user))) return completeLogin(req, res, next, user, rememberMe)
      return req.session.regenerate((regenerateError) => {
        if (regenerateError) return next(regenerateError)

        req.session.pendingTwoFactor = { userId: user.id, version: state?.session_version || 0, enrollment: !state?.enabled, rememberMe, expiresAt: factor.now() + 5 * 60000 }
        req.session.cookie.maxAge = 5 * 60000
        return req.session.save((saveError) => {
          if (saveError) return next(saveError)
          return res.json({ success: true, requiresTwoFactor: true, enrollmentRequired: !state?.enabled })
        })
      })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/logout', (req, res, next) => {
    return destroySession(req, res, next, () => res.json({ success: true }))
  })

  router.get('/me', (req, res, next) => {
    if (!req.session?.userId) {
      return res.json({ authenticated: false, user: null })
    }

    const user = findUserById(req.app.locals.database, req.session.userId)
    if (!user || user.status !== 'active' || !sessionIsValid(req, user)) {
      return destroySession(req, res, next, () =>
        res.json({ authenticated: false, user: null }),
      )
    }

    return res.json({ authenticated: true, user: toSafeUser(user) })
  })

  return router
}

module.exports = {
  createAuthRouter,
  completeLogin,
}
