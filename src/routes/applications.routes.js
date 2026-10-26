const express = require('express')
const { createHash } = require('node:crypto')
const { toDeliveryResponse } = require('../services/accessApplication.service')
const { normalizeEmail } = require('../db/users')

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function createApplicationsRouter() {
  const router = express.Router()

  router.post('/', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store')
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

      // Session ID 本身是随机值；稳定派生避免同一会话首次并发请求互相覆盖 owner。
      if (!req.session.applicationOwnerId) req.session.applicationOwnerId = createHash('sha256').update(`application-owner:${req.sessionID}`).digest('hex')
      // 在发送前保存匿名会话，避免响应中断造成已落库申请失去所属会话。
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()))
      const result = await req.app.locals.applicationDelivery.submit({
        email: normalizedEmail,
        nickname: normalizedNickname,
        reason: typeof reason === 'string' ? reason.trim() || null : null,
      }, req.session.applicationOwnerId, req.requestId)

      if (result.type === 'unavailable') {
        return res.status(503).json({ success: false, message: '申请通知服务暂不可用，请稍后再试' })
      }

      if (result.type === 'user_exists') {
        return res.status(409).json({ success: false, message: '该邮箱已注册' })
      }
      if (result.type === 'pending_exists') {
        return res.status(409).json({ success: false, message: '该邮箱已有待审核申请' })
      }

      const body = toDeliveryResponse(result)
      return res.status(body.success ? 201 : body.retryable ? 502 : 202).json(body)
    } catch (error) {
      return next(error)
    }
  })

  router.get('/:id/notification', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store')
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, message: '申请 ID 无效' })
      }
      const result = await req.app.locals.applicationDelivery.getOwned(id, req.session.applicationOwnerId)
      if (!result) return res.status(404).json({ success: false, message: '申请不存在' })
      return res.status(200).json(toDeliveryResponse(result))
    } catch (error) { return next(error) }
  })

  return router
}

module.exports = { createApplicationsRouter }
