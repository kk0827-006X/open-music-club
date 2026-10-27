const { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } = require('node:crypto')
const bcrypt = require('bcrypt')
const { BCRYPT_COST } = require('../db/init')
const { createUser, findUserByEmail, normalizeEmail } = require('../db/users')

const MINUTE = 60000
const DAY = 24 * 60 * MINUTE
const hash = value => createHash('sha256').update(value).digest('hex')
// SQLite 默认时间是 UTC，返回 ISO 避免浏览器将其误解为本地时间。
const isoTime = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString() : null
const genericMessage = '如果该邮箱符合条件，系统将发送邮件，请查收并检查垃圾邮件。'
function fail(status, message) { throw Object.assign(new Error(message), { status, accessLifecycleError: true }) }
function bounded(operation, timeout = 10000) {
  let timer
  return Promise.race([Promise.resolve().then(operation).catch(() => 'unknown'), new Promise(resolve => { timer = setTimeout(() => resolve('unknown'), timeout) })]).finally(() => clearTimeout(timer))
}

function createAccessLifecycleService({ database: db, mail, deliveryClient, now = Date.now, encryptionKey, publicOrigin, logger = console }) {
  const key = encryptionKey ? Buffer.from(encryptionKey, 'base64') : null
  if (encryptionKey && (key.length !== 32 || key.toString('base64') !== encryptionKey)) throw new Error('APPLICATION_MAIL_ENCRYPTION_KEY 必须是 32 字节标准 Base64')
  const config = mail.getDeliveryConfig()
  const configured = Boolean(key && publicOrigin && config.enabled)
  const application = id => db.prepare('SELECT a.*, w.verified_at,w.activated_at FROM access_requests a JOIN access_workflow w ON w.application_id=a.id WHERE a.id=?').get(id)
  let interval, running, stopped = false
  function requireConfigured() { if (!configured) fail(503, '申请通知服务暂不可用，请稍后再试') }
  function encrypt(token, id) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(`omc:access:${id}`))
    const payload = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), payload].map(v => v.toString('base64')).join('.')
  }
  function decrypt(value, id) {
    const [iv, tag, payload] = value.split('.').map(v => Buffer.from(v, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(`omc:access:${id}`)); decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
  }
  function enqueue(id, kind, tokenId = null, token = null) {
    const uuid = randomUUID(), timestamp = now()
    db.prepare(`INSERT INTO access_mail_jobs(application_id,kind,token_id,ciphertext,subject,message_id,next_at,started_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, kind, tokenId, token ? encrypt(token, tokenId) : null,
      `Open Music Club：${{verify:'邮箱验证',activate:'账号激活',admin:'访问申请',rejected:'审核结果'}[kind]} ${uuid}`,
      `<omc-${uuid}@${config.from.slice(config.from.lastIndexOf('@') + 1)}>`, timestamp, timestamp, timestamp)
  }
  function cancelTokens(id, purpose) {
    db.prepare('UPDATE access_tokens SET consumed_at=? WHERE application_id=? AND purpose=? AND consumed_at IS NULL').run(now(), id, purpose)
    db.prepare("UPDATE access_mail_jobs SET status='cancelled',ciphertext=NULL,lease=NULL,lease_until=0 WHERE application_id=? AND kind=? AND status NOT IN ('delivered','cancelled')").run(id, purpose)
  }
  function issue(id, purpose) {
    cancelTokens(id, purpose)
    const token = randomBytes(32).toString('base64url'), timestamp = now()
    const result = db.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(id, purpose, hash(token), timestamp + (purpose === 'verify' ? 30 * MINUTE : DAY), timestamp)
    enqueue(id, purpose, Number(result.lastInsertRowid), token)
  }
  // 每个邮箱共享额度，跨 Session、跨用途也不能绕过。
  function allowEmail(email) {
    const digest = hash(email), timestamp = now()
    const row = db.prepare('SELECT * FROM access_resend_limits WHERE email_digest=?').get(digest)
    if (row && (timestamp - row.last_at < MINUTE || timestamp - row.window_at < DAY && row.count >= 5)) return false
    const reset = !row || timestamp - row.window_at >= DAY
    db.prepare(`INSERT INTO access_resend_limits(email_digest,last_at,window_at,count) VALUES(?,?,?,1)
      ON CONFLICT(email_digest) DO UPDATE SET last_at=excluded.last_at,window_at=excluded.window_at,count=?`)
      .run(digest, timestamp, reset ? timestamp : row.window_at, reset ? 1 : row.count + 1)
    return true
  }
  const submit = db.transaction(input => {
    requireConfigured()
    const email = normalizeEmail(input.email)
    if (findUserByEmail(db, email)) return { message: genericMessage }
    const existing = db.prepare('SELECT * FROM access_requests WHERE email=? ORDER BY id DESC LIMIT 1').get(email)
    if (existing && (existing.status !== 'rejected' || now() - Date.parse(existing.reviewed_at.includes('T') ? existing.reviewed_at : `${existing.reviewed_at.replace(' ', 'T')}Z`) < 7 * DAY)) return { message: genericMessage }
    if (!allowEmail(email)) return { message: genericMessage }
    const result = db.prepare('INSERT INTO access_requests(email,nickname,reason) VALUES(?,?,?)').run(email, input.nickname, input.reason || null)
    const id = Number(result.lastInsertRowid)
    db.prepare('INSERT INTO access_workflow(application_id,legacy_invited) VALUES(?,1)').run(id)
    issue(id, 'verify')
    return { message: genericMessage }
  })
  function tokenRow(token, purpose) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    return db.prepare('SELECT * FROM access_tokens WHERE digest=? AND purpose=? AND consumed_at IS NULL AND expires_at>?').get(hash(token), purpose, now())
  }
  const verify = db.transaction(token => {
    requireConfigured()
    const row = tokenRow(token, 'verify'), a = row && application(row.application_id)
    if (!a || a.status !== 'pending' || a.verified_at !== null) fail(400, '链接无效或已过期，请申请重新发送')
    db.prepare('UPDATE access_workflow SET verified_at=? WHERE application_id=?').run(now(), a.id)
    cancelTokens(a.id, 'verify')
    enqueue(a.id, 'admin')
    return { message: '邮箱验证成功，申请已进入审核' }
  })
  const resend = db.transaction((email, purpose) => {
    requireConfigured()
    email = normalizeEmail(email)
    if (!allowEmail(email)) return { message: genericMessage }
    const row = db.prepare('SELECT id FROM access_requests WHERE email=? ORDER BY id DESC LIMIT 1').get(email)
    const a = row && application(row.id)
    if (!a || findUserByEmail(db, email)) return { message: genericMessage }
    if (purpose === 'verify' && a.status === 'pending' && a.verified_at === null || purpose === 'activate' && a.status === 'approved' && a.activated_at === null) issue(a.id, purpose)
    return { message: genericMessage }
  })
  const review = db.transaction((id, reviewerId, approved) => {
    requireConfigured()
    const a = application(id)
    if (!a) fail(404, '申请不存在')
    if (a.status !== 'pending') fail(409, '该申请已处理')
    if (a.verified_at === null) fail(409, '申请邮箱尚未验证')
    if (findUserByEmail(db, a.email)) fail(409, '申请已无法处理')
    db.prepare('UPDATE access_requests SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status=\'pending\'')
      .run(approved ? 'approved' : 'rejected', reviewerId, new Date(now()).toISOString(), id)
    cancelTokens(id, 'verify')
    if (approved) issue(id, 'activate')
    else enqueue(id, 'rejected')
    return details(application(id))
  })
  async function activate(token, password) {
    requireConfigured()
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 15 || Buffer.byteLength(password, 'utf8') > 72) fail(400, '密码必须为 15～72 字节')
    if (!tokenRow(token, 'activate')) fail(400, '链接无效或已过期，请申请重新发送')
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    return db.transaction(() => {
      const row = tokenRow(token, 'activate'), a = row && application(row.application_id)
      if (!a || a.status !== 'approved' || a.activated_at !== null || findUserByEmail(db, a.email)) fail(400, '链接无效或已过期，请申请重新发送')
      createUser(db, { email: a.email, nickname: a.nickname, passwordHash, mustChangePassword: false })
      db.prepare('UPDATE access_workflow SET activated_at=? WHERE application_id=?').run(now(), a.id)
      cancelTokens(a.id, 'activate')
      return { message: '账号已激活，请使用邮箱和新密码登录' }
    }).immediate()
  }
  function details(a) {
    const job = db.prepare('SELECT status FROM access_mail_jobs WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id)
    return { id:a.id, nickname:a.nickname, reason:a.reason, status:a.status === 'pending' && a.verified_at === null ? 'awaiting_verification' : a.status,
      emailVerified:a.verified_at !== null, createdAt:isoTime(a.created_at), reviewedAt:isoTime(a.reviewed_at), reviewedBy:a.reviewed_by,
      activatedAt:a.activated_at === null ? null : new Date(a.activated_at).toISOString(), notificationStatus:job?.status || null }
  }
  function list(status, page = 1) {
    const filters = {
      pending:"a.status='pending' AND w.verified_at IS NOT NULL", awaiting_activation:"a.status='approved' AND w.activated_at IS NULL",
      activated:'w.activated_at IS NOT NULL', rejected:"a.status='rejected'",
      notification_error:"EXISTS(SELECT 1 FROM access_mail_jobs j WHERE j.application_id=a.id AND j.status IN ('failed','unknown') AND j.id=(SELECT MAX(j2.id) FROM access_mail_jobs j2 WHERE j2.application_id=a.id))",
    }
    if (status && !filters[status]) fail(400, '申请状态无效')
    const where = status ? filters[status] : "(a.status!='pending' OR w.verified_at IS NOT NULL)"
    const base = `FROM access_requests a JOIN access_workflow w ON a.id=w.application_id WHERE ${where}`
    const total = db.prepare(`SELECT count(*) AS total ${base}`).get().total
    const rows = db.prepare(`SELECT a.*,w.verified_at,w.activated_at ${base} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`).all((page-1)*20)
    return { applications:rows.map(details), total, page, pageSize:20 }
  }
  const migrateLegacy = db.transaction(() => {
    if (!configured) return
    for (const row of db.prepare("SELECT a.id,a.email FROM access_requests a JOIN access_workflow w ON w.application_id=a.id WHERE a.status='pending' AND w.verified_at IS NULL AND w.legacy_invited=0").all()) {
      db.prepare('UPDATE access_workflow SET legacy_invited=1 WHERE application_id=?').run(row.id)
      if (findUserByEmail(db, row.email)) continue
      if (allowEmail(row.email)) issue(row.id, 'verify')
    }
  })
  async function processJob(job) {
    const timestamp = now(), lease = randomUUID()
    const claimed = db.prepare(`UPDATE access_mail_jobs SET lease=?,lease_until=?,status=CASE WHEN status='queued' THEN 'sending' ELSE status END,
      attempts=attempts+CASE WHEN status='queued' THEN 1 ELSE 0 END WHERE id=? AND lease_until<=? AND next_at<=? AND status=?`)
      .run(lease, timestamp + 30000, job.id, timestamp, timestamp, job.status)
    if (!claimed.changes) return
    const update = (status, delay = 10000, clear = false) => db.prepare(`UPDATE access_mail_jobs SET status=?,next_at=?,lease=NULL,lease_until=0,
      ciphertext=CASE WHEN ? THEN NULL ELSE ciphertext END WHERE id=? AND lease=?`).run(status, now()+delay, clear ? 1 : 0, job.id, lease)
    const a = application(job.application_id)
    const row = job.token_id && db.prepare('SELECT * FROM access_tokens WHERE id=?').get(job.token_id)
    if (job.token_id && (!row || row.consumed_at !== null || row.expires_at <= now())) { update('cancelled', 0, true); return }
    if (job.status === 'queued') {
      let token = null
      try { if (job.ciphertext) token = decrypt(job.ciphertext, job.token_id) }
      catch { update('failed', DAY, true); return }
      // 重发/消费会同步撤销任务；异步发送完成后必须持有原 lease 才能落库。
      const status = await bounded(() => mail.sendAccessMessage(a, {kind:job.kind,token,subject:job.subject,messageId:job.message_id,origin:publicOrigin}))
      if (status === 'failed') {
        const retry = job.attempts < 3
        update(retry ? 'queued' : 'failed', [MINUTE,5*MINUTE,15*MINUTE][job.attempts] || DAY, !retry)
      } else update(status === 'accepted' ? 'accepted' : 'unknown', 10000, true)
    } else {
      if (!deliveryClient?.configured) { update(job.status, MINUTE); return }
      const result = await bounded(() => deliveryClient.check({subject:job.subject,from:config.from,to:job.kind === 'admin' ? config.adminTo : a.email,startedAt:job.started_at}), 5000)
      update(['delivered','failed'].includes(result) ? result : result === 'pending' ? job.status : 'unknown', MINUTE, true)
    }
  }
  async function runTick() {
    if (!configured || stopped || !db.open) return
    migrateLegacy.immediate()
    // 不重发崩溃遗留的发送：SMTP DATA 可能已被接受。
    db.prepare("UPDATE access_mail_jobs SET status='unknown',ciphertext=NULL,lease=NULL,lease_until=0 WHERE status='sending' AND lease_until<=?").run(now())
    db.prepare(`UPDATE access_mail_jobs SET status='cancelled',ciphertext=NULL,lease=NULL,lease_until=0 WHERE token_id IN
      (SELECT id FROM access_tokens WHERE consumed_at IS NOT NULL OR expires_at<=?) AND status NOT IN ('delivered','cancelled')`).run(now())
    const jobs = db.prepare("SELECT * FROM access_mail_jobs WHERE status IN ('queued','accepted','unknown') AND next_at<=? AND lease_until<=? ORDER BY id LIMIT 10").all(now(),now())
    for (const job of jobs) { if (stopped || !db.open) break; await processJob(job) }
  }
  function tick() {
    if (!running) running = runTick().finally(() => { running = null })
    return running
  }
  function start() {
    if (interval || !configured) return
    stopped = false
    const safeTick = () => tick().catch(() => {
      try { logger.warn?.({ event: 'access_mail_worker_failed' }) } catch { /* 日志故障不能破坏任务恢复。 */ }
    })
    interval = setInterval(safeTick, 5000); interval.unref(); safeTick()
  }
  async function stop() { stopped = true; clearInterval(interval); interval = null; await running }
  return { configured, submit: input => submit.immediate(input), verify: token => verify.immediate(token), resend:(email,purpose)=>resend.immediate(email,purpose),
    review:(id,reviewerId,approved)=>review.immediate(id,reviewerId,approved), activate,list,tick,start,stop,migrateLegacy:()=>migrateLegacy.immediate() }
}
module.exports = { createAccessLifecycleService }
