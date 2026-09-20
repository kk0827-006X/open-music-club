const { findUserById, toSafeUser } = require('../db/users')
function clearSessionCookie(req, res) {
  const cookieName =
    req.app.locals.sessionCookieName || 'open_music_club.sid'
  const options = req.app.locals.sessionCookieOptions || {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
  }
  const { maxAge, expires, ...clearOptions } = options
  res.clearCookie(cookieName, clearOptions)
}

function requireLogin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, message: '请先登录' })
  }

  const user = findUserById(req.app.locals.database, req.session.userId)
  if (!user || user.status !== 'active') {
    return req.session.destroy((error) => {
      if (error) return next(error)
      clearSessionCookie(req, res)
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
