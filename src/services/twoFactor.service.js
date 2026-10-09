const { randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto')
const { generateSecret, generateURI, verifySync } = require('otplib')

const hash = (value) => createHash('sha256').update(value).digest('hex')
const stateFor = (db, id) => db.prepare('SELECT * FROM user_two_factor WHERE user_id = ?').get(id)
const requiredFor = (security, user) => security.production && user.role === 'admin'

function sessionIsValid(req, user) {
  const state = stateFor(req.app.locals.database, user.id)
  return (req.session.twoFactorVersion || 0) === (state?.session_version || 0)
    && (!(state?.enabled || requiredFor(req.app.locals.security, user)) || req.session.twoFactorVerified === true && state?.enabled === 1)
}

function createTwoFactorService(db, options = {}) {
  const encoded = options.encryptionKey ?? process.env.TOTP_ENCRYPTION_KEY
  const key = encoded ? Buffer.from(encoded, 'base64') : null
  if (encoded && (key.length !== 32 || key.toString('base64') !== encoded)) throw new Error('TOTP_ENCRYPTION_KEY 必须是 32 字节的标准 Base64 密钥')
  const now = options.now || Date.now
  function encrypt(secret, id) {
    if (!key) throw new Error('2FA 加密密钥未配置')
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(`omc:2fa:${id}`))
    const payload = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), payload].map(part => part.toString('base64')).join('.')
  }
  function decrypt(value, id) {
    if (!key) throw new Error('2FA 加密密钥未配置')
    const [iv, tag, payload] = value.split('.').map(part => Buffer.from(part, 'base64'))
    const cipher = createDecipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(`omc:2fa:${id}`)); cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(payload), cipher.final()]).toString('utf8')
  }
  function ensure(id) { db.prepare('INSERT OR IGNORE INTO user_two_factor(user_id) VALUES (?)').run(id) }
  function checkUnlocked(id) {
    const state = stateFor(db, id)
    if (state?.locked_until > now()) return false
    if (state?.locked_until) db.prepare('UPDATE user_two_factor SET failed_attempts = 0, locked_until = 0 WHERE user_id = ?').run(id)
    return true
  }
  function fail(id) {
    ensure(id)
    db.prepare('UPDATE user_two_factor SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts >= 4 THEN ? ELSE locked_until END WHERE user_id = ?').run(now() + 15 * 60000, id)
  }
  function step(ciphertext, id, code, after) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null
    const result = verifySync({ secret: decrypt(ciphertext, id), token: code, epoch: now() / 1000, epochTolerance: 30 })
    return result.valid && (after == null || result.timeStep > after) ? result.timeStep : null
  }
  function recoveryCodes(id) {
    const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex').match(/.{8}/g).join('-'))
    db.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(id)
    const insert = db.prepare('INSERT INTO two_factor_recovery_codes(user_id, code_hash) VALUES (?, ?)')
    for (const code of codes) insert.run(id, hash(code))
    return codes
  }
  const service = {
    available: Boolean(key), now, state: (id) => stateFor(db, id), checkUnlocked, fail,
    setup(user, sessionId) {
      const secret = generateSecret(), ciphertext = encrypt(secret, user.id)
      ensure(user.id)
      db.prepare('UPDATE user_two_factor SET pending_ciphertext = ?, pending_session_hash = ?, pending_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(ciphertext, hash(sessionId), now() + 10 * 60000, user.id)
      return { secret, otpauthUrl: generateURI({ issuer: 'Open Music Club', label: user.email, secret }) }
    },
    confirm: db.transaction((id, sessionId, code) => {
      const state = stateFor(db, id)
      if (!state?.pending_ciphertext || state.enabled || state.pending_expires_at <= now() || state.pending_session_hash !== hash(sessionId)) return null
      const counter = step(state.pending_ciphertext, id, code, null)
      if (counter == null) return null
      db.prepare(`UPDATE user_two_factor SET secret_ciphertext = pending_ciphertext, pending_ciphertext = NULL,
        pending_session_hash = NULL, pending_expires_at = NULL, enabled = 1, last_used_counter = ?,
        session_version = session_version + 1, failed_attempts = 0, locked_until = 0, confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(counter, id)
      return recoveryCodes(id)
    }),
    consume: db.transaction((id, code, recovery = false) => {
      const state = stateFor(db, id)
      if (!state?.enabled) return false
      if (recovery) {
        if (typeof code !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(code)) return false
        if (!db.prepare('UPDATE two_factor_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').run(id, hash(code)).changes) return false
      } else {
        const counter = step(state.secret_ciphertext, id, code, state.last_used_counter)
        if (counter == null) return false
        db.prepare('UPDATE user_two_factor SET last_used_counter = ? WHERE user_id = ?').run(counter, id)
      }
      db.prepare('UPDATE user_two_factor SET failed_attempts = 0, locked_until = 0 WHERE user_id = ?').run(id)
      return true
    }),
    change: db.transaction((id, code, disable) => {
      // 因子消费与状态更新共用事务，后续写入失败时一起回滚。
      if (!service.consume(id, code)) return null
      if (disable) {
        db.prepare(`UPDATE user_two_factor SET enabled = 0, secret_ciphertext = NULL, last_used_counter = NULL,
          pending_ciphertext = NULL, pending_session_hash = NULL, pending_expires_at = NULL,
          session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(id)
        db.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(id)
        return []
      }
      db.prepare('UPDATE user_two_factor SET session_version = session_version + 1 WHERE user_id = ?').run(id)
      return recoveryCodes(id)
    }),
  }
  return service
}
module.exports = { createTwoFactorService, stateFor, sessionIsValid, requiredFor }
