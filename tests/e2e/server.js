const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const express = require('express')
const bcrypt = require('bcrypt')
const { createApp } = require('../../src/app')
const { createUser } = require('../../src/db/users')
const { ADMIN, CLOUD } = require('./fixtures')

async function start() {
  if (process.env.NODE_ENV === 'production') throw new Error('隔离验收服务禁止在生产环境启动')
  const dist = path.resolve(__dirname, '../../frontend/dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('请先运行 pnpm build:web')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-e2e-'))
  const app = createApp({
    databasePath: path.join(directory, 'database.sqlite'), sessionSecret: 'isolated-acceptance-session-only',
    twoFactor: { encryptionKey: Buffer.alloc(32, 11).toString('base64') },
    localMusic: { storageRoot: path.join(directory, 'storage'), maximumUploadMegabytes: 5 },
    // 隔离验收只模拟 SMTP 和投递查询，不读取真实凭据或发送邮件。
    mail: {
      env: { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com' },
      transport: { async sendMail(message) { return { accepted: [message.to] } } },
      deliveryClient: { configured: true, async check() { return 'delivered' } },
    },
    security: { production: false, publicOrigin: 'http://127.0.0.1:4317', csrfEnabled: true, rateLimitEnabled: true,
      logger: { info() {}, warn() {}, error(event) { console.error(JSON.stringify(event)) } } },
    // 仅在独立测试进程中注入上游适配；不添加任何生产测试后门。
    neteaseService: { async call(name) {
      if (name === 'search') return { code: 200, result: { songs: [CLOUD] } }
      if (name === 'songDetail') return { code: 200, songs: [CLOUD] }
      if (name === 'songUrlV1') return { code: 200, data: [{ id: CLOUD.id, url: 'https://e2e.music.126.net/audio.wav' }] }
      if (name === 'lyric') return { code: 200, lrc: { lyric: '[00:00.00]验收第一句歌词\n[00:01.00]验收第二句歌词' } }
      if (name === 'album') return { code: 200, songs: [CLOUD] }
      throw new Error('测试未支持的上游调用')
    } },
  })
  createUser(app.locals.database, { ...ADMIN, nickname: '验收管理员', passwordHash: await bcrypt.hash(ADMIN.password, 4), role: 'admin', status: 'active', mustChangePassword: false })
  const web = express()
  web.use((req, res, next) => req.path.startsWith('/api/') || req.path === '/health' ? app(req, res, next) : next())
  web.use(express.static(dist))
  const server = web.listen(4317, '127.0.0.1')
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    server.close(() => {
      app.locals.sessionStore.stopInterval?.()
      app.locals.database.close()
      fs.rmSync(directory, { recursive: true, force: true })
      process.exit(0)
    })
    server.closeAllConnections()
  }
  process.on('SIGTERM', close); process.on('SIGINT', close)
}
start().catch(() => { console.error('隔离验收服务启动失败'); process.exitCode = 1 })
