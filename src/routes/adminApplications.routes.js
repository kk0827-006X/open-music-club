const bcrypt = require('bcrypt')
const express = require('express')
const {
  APPLICATION_STATUSES,
  approveApplication,
  findApplicationById,
  listApplications,
  rejectApplication,
  toApplicationDetails,
} = require('../db/applications')
const { BCRYPT_COST } = require('../db/init')
const { toSafeUser } = require('../db/users')

function parseApplicationId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function createAdminApplicationsRouter() {
  const router = express.Router()

  router.get('/', (req, res, next) => {
    try {
      const { status } = req.query
      if (
        status !== undefined &&
        (typeof status !== 'string' || !APPLICATION_STATUSES.has(status))
      ) {
        return res.status(400).json({ success: false, message: '申请状态无效' })
      }

      const applications = listApplications(req.app.locals.database, status).map(
        toApplicationDetails,
      )
      return res.status(200).json({ success: true, applications })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/:id/approve', async (req, res, next) => {
    try {
      const id = parseApplicationId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '申请 ID 无效' })
      }

      const database = req.app.locals.database
      const application = findApplicationById(database, id)
      if (!application) {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }
      if (application.status !== 'pending') {
        return res.status(409).json({ success: false, message: '该申请已处理' })
      }

      const { initialPassword } = req.body ?? {}
      if (typeof initialPassword !== 'string' || initialPassword.length < 8) {
        return res.status(400).json({ success: false, message: '初始密码至少需要 8 位' })
      }

      const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST)
      const result = approveApplication(database, {
        id,
        reviewerId: req.user.id,
        passwordHash,
      })

      if (result.type === 'not_found') {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }
      if (result.type === 'not_pending') {
        return res.status(409).json({ success: false, message: '该申请已处理' })
      }
      if (result.type === 'user_exists') {
        return res.status(409).json({ success: false, message: '该邮箱已注册' })
      }

      return res.status(200).json({ success: true, user: toSafeUser(result.user) })
    } catch (error) {
      return next(error)
    }
  })

  router.post('/:id/reject', (req, res, next) => {
    try {
      const id = parseApplicationId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '申请 ID 无效' })
      }

      const result = rejectApplication(req.app.locals.database, {
        id,
        reviewerId: req.user.id,
      })

      if (result.type === 'not_found') {
        return res.status(404).json({ success: false, message: '申请不存在' })
      }
      if (result.type === 'not_pending') {
        return res.status(409).json({ success: false, message: '该申请已处理' })
      }

      return res.status(200).json({
        success: true,
        application: toApplicationDetails(result.application),
      })
    } catch (error) {
      return next(error)
    }
  })

  return router
}

module.exports = { createAdminApplicationsRouter }
