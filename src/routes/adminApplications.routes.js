const express = require('express')
const { lifecycleResponse } = require('./applications.routes')
function createAdminApplicationsRouter() {
  const router = express.Router()
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store')
    const factor = req.app.locals.twoFactor.state(req.user.id)
    if (factor?.enabled !== 1 || req.session.twoFactorVerified !== true) return res.status(403).json({success:false,message:'请启用并完成管理员两步验证'})
    return next()
  })
  router.get('/', (req,res,next) => {
    if (Object.keys(req.query).some(key => !['page', 'status'].includes(key))) return res.status(400).json({success:false,message:'查询参数无效'})
    const page = req.query.page === undefined ? 1 : Number(req.query.page)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || (req.query.status !== undefined && typeof req.query.status !== 'string')) return res.status(400).json({success:false,message:'分页或状态无效'})
    return lifecycleResponse(res,next,()=>req.app.locals.accessLifecycle.list(req.query.status,page))
  })
  for (const action of ['approve','reject']) router.post(`/:id/${action}`, (req,res,next) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({success:false,message:'申请 ID 无效'})
    if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({success:false,message:'审批无需提供密码或其他参数'})
    return lifecycleResponse(res,next,()=>({application:req.app.locals.accessLifecycle.review(id,req.user.id,action === 'approve')}))
  })
  // 补发只按申请 ID 查找服务端保存的邮箱；沿用父路由的 admin、Session、2FA、CSRF 与审批 IP 限流。
  router.post('/:id/resend-activation', (req,res,next) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({success:false,message:'申请 ID 无效'})
    if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({success:false,message:'补发无需提供邮箱或其他参数'})
    return lifecycleResponse(res,next,()=>({application:req.app.locals.accessLifecycle.resendActivation(id)}))
  })
  return router
}
module.exports = { createAdminApplicationsRouter }
