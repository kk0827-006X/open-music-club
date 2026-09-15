const { findUserById, toSafeUser } = require('../db/users')
const { SESSION_COOKIE_NAME } = require('../config/session')

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  })
}

function requireLogin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, message: '请先登录' })
  }

  const user = findUserById(req.app.locals.database, req.session.userId)
  if (!user || user.status !== 'active') {
    return req.session.destroy((error) => {
      if (error) return next(error)
      clearSessionCookie(res)
      return res.status(401).json({ success: false, message: '登录状态已失效' })
    })
  }

  req.user = user
  req.safeUser = toSafeUser(user)
  return next()
}

module.exports = {
  clearSessionCookie,
  requireLogin,
}
