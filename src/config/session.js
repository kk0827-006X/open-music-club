const session = require('express-session')

const SESSION_COOKIE_NAME = 'open_music_club.sid'

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

  const middleware = session({
    name: cookieName,
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: Boolean(sessionIdleTimeoutMinutes),
    cookie: cookieOptions,
  })

  return { middleware, store, cookieName, cookieOptions }
}

function createMemorySessionStore() {
  return new session.MemoryStore()
}

module.exports = {
  SESSION_COOKIE_NAME,
  createMemorySessionStore,
  createSessionMiddleware,
}
