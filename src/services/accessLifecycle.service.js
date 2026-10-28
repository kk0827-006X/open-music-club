const { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } = require('node:crypto')
const bcrypt = require('bcrypt')
const { BCRYPT_COST } = require('../db/init')
const { createUser, findUserByEmail, normalizeEmail } = require('../db/users')

const MINUTE = 60000
const DAY = 24 * 60 * MINUTE
// 激活密码：8～72 个可打印 ASCII 字符（0x21～0x7E），且四类字符齐全。
// 不做 trim 或截断；72 位上限避免 bcrypt 截断。已有账号密码不受此规则影响。
const ACTIVATION_PASSWORD_RULE = '密码只能由半角英文字母、数字和英文符号组成，长度 8～72 位，且需同时包含大写字母、小写字母、数字和符号'
function isValidActivationPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return false
  let upper = false, lower = false, digit = false, symbol = false
  for (let index = 0; index < password.length; index++) {
    const code = password.charCodeAt(index)
    if (code < 0x21 || code > 0x7e) return false
    if (code >= 0x41 && code <= 0x5a) upper = true
    else if (code >= 0x61 && code <= 0x7a) lower = true
    else if (code >= 0x30 && code <= 0x39) digit = true
    else symbol = true
  }
  return upper && lower && digit && symbol
}
const hash = value => createHash('sha256').update(value).digest('hex')
// SQLite 默认时间是 UTC，返回 ISO 避免浏览器将其误解为本地时间。
const isoTime = value => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString() : null
const genericMessage = '符合条件的申请会进入审核，审核结果通过邮件通知。'
function fail(status, message) { throw Object.assign(new Error(message), { status, accessLifecycleError: true }) }
function bounded(operation, timeout = 10000) {
  let timer
  return Promise.race([Promise.resolve().then(operation).catch(() => 'unknown'), new Promise(resolve => { timer = setTimeout(() => resolve('unknown'), timeout) })]).finally(() => clearTimeout(timer))
}

function createAccessLifecycleService({ database: db, mail, deliveryClient, now = Date.now, encryptionKey, publicOrigin, logger = console }) {
  const key = encryptionKey ? Buffer.from(encryptionKey, 'base64') : null
  if (encryptionKey && (key.length !== 32 || key.toString('base64') !== encryptionKey)) throw new Error('APPLICATION_MAIL_ENCRYPTION_KEY 必须是 32 字节标准 Base64')
  const config = mail.getDeliveryConfig()
  const missingConfiguration = [
    !config.enabled && 'MAIL_ENABLED',
    !publicOrigin && 'PUBLIC_ORIGIN',
    !key && 'APPLICATION_MAIL_ENCRYPTION_KEY',
  ].filter(Boolean)
  const configured = missingConfiguration.length === 0
  function log(level, event) {
    try { logger[level]?.(event) } catch { /* 日志故障不能破坏业务和任务恢复。 */ }
  }
  const application = id => db.prepare('SELECT a.*, w.verified_at,w.activated_at FROM access_requests a JOIN access_workflow w ON w.application_id=a.id WHERE a.id=?').get(id)
  const latestJob = (id, kind) => db.prepare('SELECT status FROM access_mail_jobs WHERE application_id=? AND kind=? ORDER BY id DESC LIMIT 1').get(id, kind)
  // 管理员提醒只是辅助，不含邮箱、理由或 Token；提交时入队一次，历史迁移不补发。
  function notifyAdmin(id) {
    if (!db.prepare("SELECT 1 FROM access_mail_jobs WHERE application_id=? AND kind='admin'").get(id)) enqueue(id, 'admin')
  }
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
  // 新 Token 成功落库后才撤销旧凭证与旧任务；调用方的数据库事务失败时整体回滚。
  function issue(id, purpose) {
    const token = randomBytes(32).toString('base64url'), timestamp = now()
    const result = db.prepare('INSERT INTO access_tokens(application_id,purpose,digest,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(id, purpose, hash(token), timestamp + DAY, timestamp)
    const tokenId = Number(result.lastInsertRowid)
    db.prepare('UPDATE access_tokens SET consumed_at=? WHERE application_id=? AND purpose=? AND consumed_at IS NULL AND id<>?')
      .run(timestamp, id, purpose, tokenId)
    db.prepare("UPDATE access_mail_jobs SET status='cancelled',ciphertext=NULL,lease=NULL,lease_until=0 WHERE application_id=? AND kind=? AND status NOT IN ('delivered','cancelled')")
      .run(id, purpose)
    enqueue(id, purpose, tokenId, token)
  }
  // 申请提交与激活邮件使用独立额度命名空间。申请沿用无命名空间的旧摘要，升级后旧额度仍生效；
  // 激活邮件使用独立摘要，避免刚提交的 60 秒申请冷却阻塞首次审批发信。
  const emailDigest = (email, namespace) => hash(namespace === 'application' ? email : `omc:access:${namespace}:${email}`)
  function allowEmail(email, namespace = 'application') {
    const digest = emailDigest(email, namespace), timestamp = now()
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
    // 新申请直接进入待审核，不再签发验证凭证；legacy_invited=1 表示无需历史迁移。
    db.prepare('INSERT INTO access_workflow(application_id,legacy_invited) VALUES(?,1)').run(id)
    notifyAdmin(id)
    return { message: genericMessage }
  })
  function tokenRow(token, purpose) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    return db.prepare('SELECT * FROM access_tokens WHERE digest=? AND purpose=? AND consumed_at IS NULL AND expires_at>?').get(hash(token), purpose, now())
  }
  const resend = db.transaction((email, purpose) => {
    requireConfigured()
    if (purpose !== 'activate') fail(400, '申请流程已简化，无需验证邮箱；仅支持重发激活邮件')
    email = normalizeEmail(email)
    const row = db.prepare('SELECT id FROM access_requests WHERE email=? ORDER BY id DESC LIMIT 1').get(email)
    const a = row && application(row.id)
    // 公开入口继续返回统一提示，不泄露邮箱是否存在或申请阶段。未达到已通过阶段不发信、
    // 也不消耗激活邮件额度，避免他人提前耗尽额度阻塞首次审批发信。
    if (!a || findUserByEmail(db, email) || a.status !== 'approved' || a.activated_at !== null) return { message: genericMessage }
    if (!allowEmail(email, 'activation')) return { message: genericMessage }
    issue(a.id, 'activate')
    return { message: genericMessage }
  })
  const review = db.transaction((id, reviewerId, approved) => {
    requireConfigured()
    const a = application(id)
    if (!a) fail(404, '申请不存在')
    if (a.status !== 'pending') fail(409, '该申请已处理')
    if (findUserByEmail(db, a.email)) fail(409, '申请已无法处理')
    db.prepare('UPDATE access_requests SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status=\'pending\'')
      .run(approved ? 'approved' : 'rejected', reviewerId, new Date(now()).toISOString(), id)
    // 清掉部署前遗留的验证凭证；审核本身不再依赖邮箱验证或投递状态。
    cancelTokens(id, 'verify')
    if (approved) {
      // 首次激活邮件也计入激活邮件额度；额度使用独立命名空间，不会受刚提交的申请冷却影响。
      // 额度或入队失败必须回滚整笔审批，不能出现“已通过但没有激活任务”的状态。
      if (!allowEmail(a.email, 'activation')) fail(429, '激活邮件额度暂时不可用，审批未提交，请稍后重试')
      issue(id, 'activate')
    } else enqueue(id, 'rejected')
    return details(application(id))
  })
  // 管理员补发：先校验额度，429 时不签发新 Token，也不撤销仍可用的旧链接。
  const resendActivation = db.transaction(id => {
    requireConfigured()
    const a = application(id)
    if (!a) fail(404, '申请不存在')
    if (a.status !== 'approved' || a.activated_at !== null || findUserByEmail(db, a.email)) fail(409, '只有已通过且尚未激活的申请可以补发激活邮件')
    if (!allowEmail(a.email, 'activation')) fail(429, '操作过于频繁或今日补发次数已达上限，请稍后再试')
    issue(id, 'activate')
    return details(application(id))
  })
  async function activate(token, password) {
    requireConfigured()
    // 后端独立校验，绕过前端也不能提交不符合规则的密码；失败时尚未消费 Token。
    if (!isValidActivationPassword(password)) fail(400, ACTIVATION_PASSWORD_RULE)
    if (!tokenRow(token, 'activate')) fail(400, '链接无效或已过期，请申请重新发送')
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    return db.transaction(() => {
      const row = tokenRow(token, 'activate'), a = row && application(row.application_id)
      if (!a || a.status !== 'approved' || a.activated_at !== null || findUserByEmail(db, a.email)) fail(400, '链接无效或已过期，请申请重新发送')
      createUser(db, { email: a.email, nickname: a.nickname, passwordHash, mustChangePassword: false })
      // 只有申请人本人成功设置密码时才记录邮箱确认时间，不冒充验证邮件送达。
      db.prepare(`UPDATE access_workflow SET activated_at=?,
        verified_at=CASE WHEN verified_at IS NULL OR verified_at=0 THEN ? ELSE verified_at END WHERE application_id=?`).run(now(), now(), a.id)
      cancelTokens(a.id, 'activate')
      return { message: '账号已激活，请使用邮箱和新密码登录' }
    }).immediate()
  }
  function details(a) {
    const job = db.prepare('SELECT status FROM access_mail_jobs WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id)
    return {
      id: a.id, nickname: a.nickname, reason: a.reason, status: a.status,
      canReview: a.status === 'pending',
      canResendActivation: a.status === 'approved' && a.activated_at === null && !findUserByEmail(db, a.email),
      // 只读取最新激活任务，管理员提醒或其他通知不能覆盖激活邮件状态。
      activationMailStatus: latestJob(a.id, 'activate')?.status || null,
      notificationStatus: job?.status || null,
      emailVerified: a.verified_at !== null,
      createdAt: isoTime(a.created_at), reviewedAt: isoTime(a.reviewed_at), reviewedBy: a.reviewed_by,
      activatedAt: a.activated_at === null ? null : new Date(a.activated_at).toISOString(),
    }
  }
  function list(status, page = 1) {
    const filters = {
      pending: "a.status='pending'",
      awaiting_activation: "a.status='approved' AND w.activated_at IS NULL",
      activated: 'w.activated_at IS NOT NULL',
      rejected: "a.status='rejected'",
      // 只看当前业务相关邮件：已通过看最新激活邮件，已拒绝看最新拒绝通知；管理员提醒失败不混淆。
      notification_error: `EXISTS(SELECT 1 FROM access_mail_jobs j WHERE j.application_id=a.id
        AND j.kind=CASE WHEN a.status='approved' THEN 'activate' WHEN a.status='rejected' THEN 'rejected' ELSE NULL END
        AND j.status IN ('failed','unknown')
        AND j.id=(SELECT MAX(j2.id) FROM access_mail_jobs j2 WHERE j2.application_id=a.id AND j2.kind=j.kind))`,
    }
    if (status && !filters[status]) fail(400, '申请状态无效')
    const where = status ? filters[status] : '1=1'
    const base = `FROM access_requests a JOIN access_workflow w ON a.id=w.application_id WHERE ${where}`
    const total = db.prepare(`SELECT count(*) AS total ${base}`).get().total
    const rows = db.prepare(`SELECT a.*,w.verified_at,w.activated_at ${base} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`).all((page - 1) * 20)
    return { applications: rows.map(details), total, page, pageSize: 20 }
  }
  const migrateLegacy = db.transaction(() => {
    if (!configured) return
    // 旧版待审申请直接改为可审核：撤销全部旧验证凭证与任务、清空密文和 lease，只补迁移标记。
    // 即使旧版已经置过 invited 标记，也可能仍有未消费的验证链接，因此按用途全局幂等清理。
    // 不向历史申请补发验证邀请，也不生成历史管理员提醒，避免部署时额外真实发信。
    db.prepare('UPDATE access_tokens SET consumed_at=? WHERE purpose=? AND consumed_at IS NULL').run(now(), 'verify')
    db.prepare(`UPDATE access_mail_jobs SET status=CASE WHEN status IN ('delivered','cancelled') THEN status ELSE 'cancelled' END,
      ciphertext=NULL,lease=NULL,lease_until=0 WHERE kind='verify'
      AND (ciphertext IS NOT NULL OR lease IS NOT NULL OR status NOT IN ('delivered','cancelled'))`).run()
    db.prepare('UPDATE access_workflow SET legacy_invited=1 WHERE legacy_invited=0').run()
  })
  async function processJob(job) {
    const timestamp = now(), lease = randomUUID()
    const claimed = db.prepare(`UPDATE access_mail_jobs SET lease=?,lease_until=?,status=CASE WHEN status='queued' THEN 'sending' ELSE status END,
      started_at=CASE WHEN status='queued' AND attempts=0 THEN ? ELSE started_at END,
      attempts=attempts+CASE WHEN status='queued' THEN 1 ELSE 0 END WHERE id=? AND lease_until<=? AND next_at<=? AND status=?`)
      .run(lease, timestamp + 30000, timestamp, job.id, timestamp, timestamp, job.status)
    if (!claimed.changes) return
    const update = (status, delay = 10000, clear = false) => db.prepare(`UPDATE access_mail_jobs SET status=?,next_at=?,lease=NULL,lease_until=0,
      ciphertext=CASE WHEN ? THEN NULL ELSE ciphertext END WHERE id=? AND lease=?`).run(status, now() + delay, clear ? 1 : 0, job.id, lease)
    const a = application(job.application_id)
    const row = job.token_id && db.prepare('SELECT * FROM access_tokens WHERE id=?').get(job.token_id)
    if (job.token_id && (!row || row.consumed_at !== null || row.expires_at <= now())) { update('cancelled', 0, true); return }
    if (job.status === 'queued') {
      let token = null
      try { if (job.ciphertext) token = decrypt(job.ciphertext, job.token_id) }
      catch { update('failed', DAY, true); return }
      // 重发/消费会同步撤销任务；异步发送完成后必须持有原 lease 才能落库。
      const status = await bounded(() => mail.sendAccessMessage(a, { kind: job.kind, token, subject: job.subject, messageId: job.message_id, origin: publicOrigin }))
      if (status === 'failed') {
        const retry = job.attempts < 3
        update(retry ? 'queued' : 'failed', [MINUTE, 5 * MINUTE, 15 * MINUTE][job.attempts] || DAY, !retry)
      } else update(status === 'accepted' ? 'accepted' : 'unknown', 10000, true)
    } else {
      if (job.started_at <= now() - DAY) { update('unknown', DAY, true); return }
      if (!deliveryClient?.configured) { update(job.status, MINUTE); return }
      const result = await bounded(() => deliveryClient.check({ subject: job.subject, from: config.from, to: job.kind === 'admin' ? config.adminTo : a.email, startedAt: job.started_at }), 5000)
      db.transaction(() => {
        update(['delivered', 'failed'].includes(result) ? result : result === 'pending' ? job.status : 'unknown', MINUTE, true)
      }).immediate()
    }
  }
  async function runTick() {
    if (!configured || stopped || !db.open) return
    migrateLegacy.immediate()
    // 不重发崩溃遗留的发送：SMTP DATA 可能已被接受。
    db.prepare("UPDATE access_mail_jobs SET status='unknown',ciphertext=NULL,lease=NULL,lease_until=0 WHERE status='sending' AND lease_until<=?").run(now())
    db.prepare(`UPDATE access_mail_jobs SET status='cancelled',ciphertext=NULL,lease=NULL,lease_until=0 WHERE token_id IN
      (SELECT id FROM access_tokens WHERE consumed_at IS NOT NULL OR expires_at<=?) AND status NOT IN ('delivered','failed','cancelled')`).run(now())
    // 发送与查询各有独立额度，历史慢查询不能占满新邮件的发送机会。
    const sending = db.prepare("SELECT * FROM access_mail_jobs WHERE status='queued' AND next_at<=? AND lease_until<=? ORDER BY next_at,id LIMIT 10").all(now(), now())
    for (const job of sending) { if (stopped || !db.open) return; await processJob(job) }
    // 24 小时仍无最终结果则保持未知，停止自动查询，也不自动重发。
    db.prepare(`UPDATE access_mail_jobs SET status='unknown',ciphertext=NULL,lease=NULL,lease_until=0,next_at=?
      WHERE status IN ('accepted','unknown') AND started_at<=? AND next_at<=? AND lease_until<=?`)
      .run(now() + DAY, now() - DAY, now(), now())
    const checking = db.prepare("SELECT * FROM access_mail_jobs WHERE status IN ('accepted','unknown') AND next_at<=? AND lease_until<=? AND started_at>? ORDER BY next_at,id LIMIT 10").all(now(), now(), now() - DAY)
    for (const job of checking) { if (stopped || !db.open) return; await processJob(job) }
  }
  function tick() {
    if (!running) running = runTick().finally(() => { running = null })
    return running
  }
  function start() {
    if (interval) return
    if (!configured) { log('warn', { event: 'access_mail_unavailable', missingConfiguration }); return }
    stopped = false
    const safeTick = () => tick().catch(() => {
      log('warn', { event: 'access_mail_worker_failed' })
    })
    log('info', { event: 'access_mail_worker_started' })
    interval = setInterval(safeTick, 5000); interval.unref(); safeTick()
  }
  async function stop() { stopped = true; clearInterval(interval); interval = null; await running }
  return {
    configured,
    submit: input => submit.immediate(input),
    resend: (email, purpose) => resend.immediate(email, purpose),
    review: (id, reviewerId, approved) => review.immediate(id, reviewerId, approved),
    resendActivation: id => resendActivation.immediate(id),
    activate, list, tick, start, stop,
    migrateLegacy: () => migrateLegacy.immediate(),
  }
}
module.exports = { createAccessLifecycleService, isValidActivationPassword }
