const dotenv = require('dotenv')
const { createApp } = require('./app')
const { getSessionDatabasePath } = require('./config/session')

dotenv.config({ quiet: true })

const databasePath =
  process.env.DATABASE_PATH || './data/open-music-club.sqlite'
const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'

const app = createApp({
  databasePath,
  sessionDatabasePath: getSessionDatabasePath(databasePath),
  sessionSecret: process.env.SESSION_SECRET,
})

app.listen(port, host, () => {
  console.log(`Open Music Club 已启动：http://${host}:${port}`)
})
