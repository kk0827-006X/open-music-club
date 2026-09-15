const express = require('express')
const {
  submitApplication,
  toApplicationSummary,
} = require('../db/applications')
const { normalizeEmail } = require('../db/users')

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function createApplicationsRouter() {
  const router = express.Router()

  router.post('/', (req, res, next) => {
    try {
      const { email, nickname, reason } = req.body ?? {}
      const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : ''
      const normalizedNickname = typeof nickname === 'string' ? nickname.trim() : ''

      if (!normalizedEmail || !BASIC_EMAIL_PATTERN.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: '请提供有效的邮箱' })
      }
      if (!normalizedNickname) {
        return res.status(400).json({ success: false, message: '昵称不能为空' })
      }
      if (reason !== undefined && reason !== null && typeof reason !== 'string') {
        return res.status(400).json({ success: false, message: '申请理由格式不正确' })
      }

      const result = submitApplication(req.app.locals.database, {
        email: normalizedEmail,
        nickname: normalizedNickname,
        reason: typeof reason === 'string' ? reason.trim() || null : null,
      })

      if (result.type === 'user_exists') {
        return res.status(409).json({ success: false, message: '该邮箱已注册' })
      }
      if (result.type === 'pending_exists') {
        return res.status(409).json({ success: false, message: '该邮箱已有待审核申请' })
      }

      return res.status(201).json({
        success: true,
        application: toApplicationSummary(result.application),
      })
    } catch (error) {
      return next(error)
    }
  })

  return router
}

module.exports = { createApplicationsRouter }
