const express = require('express')
const bcrypt = require('bcrypt')
const { findUserByEmail, findUserById, toSafeUser } = require('../db/users')
const { clearSessionCookie } = require('../middleware/requireLogin')
const { REMEMBER_LOGIN_MAX_AGE_MS } = require('../config/session')

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

      return req.session.regenerate((regenerateError) => {
        if (regenerateError) return next(regenerateError)

        req.session.userId = user.id
        req.session.role = user.role
        if (rememberMe) {
          const security = req.app.locals.security
          // 公网管理员不因勾选保持登录而放宽原有的短时会话策略。
          const duration = security.production && user.role === 'admin'
            ? Math.min(REMEMBER_LOGIN_MAX_AGE_MS, security.sessionIdleTimeoutMinutes * 60 * 1000)
            : REMEMBER_LOGIN_MAX_AGE_MS
          req.session.rememberUntil = Date.now() + duration
          req.session.cookie.maxAge = duration
        }
        return req.session.save((saveError) => {
          if (saveError) return next(saveError)
          return res.json({ success: true, user: toSafeUser(user) })
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
    if (!user || user.status !== 'active') {
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
}
