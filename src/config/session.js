const fs = require('node:fs')
const path = require('node:path')
const session = require('express-session')
const SQLiteStoreFactory = require('connect-sqlite3')

const SESSION_COOKIE_NAME = 'open_music_club.sid'

function createSessionMiddleware({ sessionSecret, sessionDatabasePath }) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET 不能为空')
  }
  if (!sessionDatabasePath) {
    throw new Error('Session 数据库路径不能为空')
  }

  const absolutePath = path.resolve(sessionDatabasePath)
  const directory = path.dirname(absolutePath)
  fs.mkdirSync(directory, { recursive: true })

  const SQLiteStore = SQLiteStoreFactory(session)
  const store = new SQLiteStore({
    db: path.basename(absolutePath),
    dir: directory,
    createDirIfNotExists: true,
    concurrentDb: true,
  })

  const middleware = session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })

  return { middleware, store }
}

function getSessionDatabasePath(databasePath) {
  return path.join(path.dirname(path.resolve(databasePath)), 'sessions.sqlite')
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionMiddleware,
  getSessionDatabasePath,
}
