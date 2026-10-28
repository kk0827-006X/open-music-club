const express = require('express')
const { normalizeEmail } = require('../db/users')
const validEmail = value => typeof value === 'string' && value.trim().length <= 254 && /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value.trim())
const VERIFY_DISABLED_MESSAGE = '申请流程已简化，已提交申请无需邮箱验证，请等待管理员审核。'
function lifecycleResponse(res, next, operation, status = 200) {
  return Promise.resolve().then(operation).then(result => res.status(status).json({success:true,...result})).catch(error => {
    if (error.accessLifecycleError) return res.status(error.status).json({success:false,message:error.message})
    return next(error)
  })
}
function createApplicationsRouter() {
  const router = express.Router()
  router.use((req,res,next) => { res.set('Cache-Control','no-store'); next() })
  router.post('/', (req,res,next) => {
    const {email,nickname,reason} = req.body || {}
    if (!validEmail(email)) return res.status(400).json({success:false,message:'请提供有效的邮箱'})
    if (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 80) return res.status(400).json({success:false,message:'昵称需为 1～80 个字符'})
    if (reason != null && (typeof reason !== 'string' || reason.length > 2000)) return res.status(400).json({success:false,message:'申请理由不能超过 2000 个字符'})
    return lifecycleResponse(res,next,()=>req.app.locals.accessLifecycle.submit({email:normalizeEmail(email),nickname:nickname.trim(),reason:reason?.trim() || null}),202)
  })
  // 旧入口保留固定说明，不再消费任何凭证，也不触发审核或发信。
  router.all('/verify-email', (req,res) => res.status(410).json({success:false,message:VERIFY_DISABLED_MESSAGE}))
  router.post('/resend', (req,res,next) => {
    const {email,purpose} = req.body || {}
    if (!validEmail(email)) return res.status(400).json({success:false,message:'请提供有效的邮箱'})
    if (purpose !== 'activate') return res.status(400).json({success:false,message:'申请流程已简化，无需验证邮箱；仅支持重发激活邮件'})
    return lifecycleResponse(res,next,()=>req.app.locals.accessLifecycle.resend(email,'activate'),202)
  })
  return router
}
module.exports = { createApplicationsRouter, lifecycleResponse, VERIFY_DISABLED_MESSAGE }
