const session = require('express-session')
const { clearSessionCookie } = require('../middleware/requireLogin')

const SESSION_COOKIE_NAME = 'open_music_club.sid'
const REMEMBER_LOGIN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function createSessionMiddleware({
  sessionSecret,
  store,
  cookieName = SESSION_COOKIE_NAME,
  secureCookies = false,
  sessionIdleTimeoutMinutes,
}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET 不能为空')
  }
  if (!store) throw new Error('Session Store 不能为空')

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies,
    path: '/',
  }
  if (sessionIdleTimeoutMinutes) {
    cookieOptions.maxAge = sessionIdleTimeoutMinutes * 60 * 1000
  }

  const sessionMiddleware = session({
    name: cookieName,
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: Boolean(sessionIdleTimeoutMinutes),
    cookie: cookieOptions,
  })

  // 固定截止时间不能因为 Cookie 滚动续期而延长，也不能只依赖浏览器自行删除 Cookie。
  const middleware = (req, res, next) => {
    sessionMiddleware(req, res, (error) => {
      if (error) return next(error)
      const deadline = req.session?.rememberUntil
      if (deadline === undefined) return next()
      if (!Number.isFinite(deadline) || deadline <= Date.now()) {
        return req.session.regenerate((regenerateError) => {
          if (regenerateError) return next(regenerateError)
          clearSessionCookie(req, res)
          return next()
        })
      }
      req.session.cookie.maxAge = deadline - Date.now()
      return next()
    })
  }

  return { middleware, store, cookieName, cookieOptions }
}

function createMemorySessionStore() {
  return new session.MemoryStore()
}

module.exports = {
  SESSION_COOKIE_NAME,
  REMEMBER_LOGIN_MAX_AGE_MS,
  createMemorySessionStore,
  createSessionMiddleware,
}
