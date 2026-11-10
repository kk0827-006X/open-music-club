const { createHash, randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { BCRYPT_COST } = require('../db/init');
const { findUserByEmail, findUserById, normalizeEmail } = require('../db/users');
const { isValidActivationPassword } = require('./accessLifecycle.service');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const generic = '如果该邮箱对应可用账号，系统会发送密码重置邮件，请查收收件箱和垃圾邮件。';
const reject = (status, message) => {
  throw Object.assign(new Error(message), { passwordError: true, status });
};

function createPasswordService({
  database: db,
  factor,
  mail,
  publicOrigin,
  logger,
  now = Date.now,
}) {
  const pending = new Set();
  function send(user, kind, token) {
    // 传输与公开响应解耦，SMTP 时延和结果不暴露账号是否存在；凭证只在发送期间留在内存。
    const job = Promise.resolve()
      .then(() => mail.sendPasswordMessage(user, { kind, token, origin: publicOrigin }))
      .catch(() => {
        try {
          logger.warn?.({ event: 'password_mail_failed', userId: user.id });
        } catch {
          /* 不回显传输错误。 */
        }
      });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  const issueReset = db.transaction((email) => {
    if (!mail.getDeliveryConfig().enabled || !publicOrigin)
      reject(503, '密码找回服务暂时不可用，请联系管理员');
    email = normalizeEmail(email);
    if (email.length > 254 || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email))
      reject(400, '请输入有效的注册邮箱');
    const timestamp = now(),
      day = Math.floor(timestamp / 86400000),
      key = digest(email);
    db.prepare('DELETE FROM password_reset_requests WHERE last_at < ?').run(
      timestamp - 2 * 86400000,
    );
    db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(timestamp);
    const previous = db
      .prepare('SELECT * FROM password_reset_requests WHERE email_digest=?')
      .get(key);
    // 已存在、未知、禁用账号共享相同的邮箱额度与响应，超额不继续发信。
    if (
      previous &&
      (timestamp - previous.last_at < 60000 || (previous.day === day && previous.count >= 5))
    )
      return generic;
    db.prepare(
      `INSERT INTO password_reset_requests VALUES(?,?,?,1) ON CONFLICT(email_digest)
      DO UPDATE SET last_at=excluded.last_at, day=excluded.day, count=CASE WHEN day=excluded.day THEN count+1 ELSE 1 END`,
    ).run(key, timestamp, day);
    const user = findUserByEmail(db, email);
    if (user?.status === 'active') {
      const token = randomBytes(32).toString('base64url');
      // 新邮件不撤销尚有效的链接，避免第三方请求找回就让用户已有邮件失效；成功改密统一撤销。
      db.prepare(
        'INSERT INTO password_reset_tokens(digest,user_id,version,expires_at) VALUES(?,?,?,?)',
      ).run(
        digest(token),
        user.id,
        factor.state(user.id)?.session_version || 0,
        timestamp + 15 * 60000,
      );
      return { user, token };
    }
    return generic;
  });
  function requestReset(email) {
    const issued = issueReset.immediate(email);
    if (typeof issued === 'object') send(issued.user, 'reset', issued.token);
    return generic;
  }
  function tokenRow(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db
      .prepare('SELECT * FROM password_reset_tokens WHERE digest=? AND expires_at>? AND attempts<5')
      .get(digest(token), now());
  }
  async function update(input, currentUser) {
    if (!input || !isValidActivationPassword(input.newPassword))
      reject(400, '新密码需为8～72位半角字符，包含大写字母、小写字母、数字和符号');
    if (typeof input.recovery !== 'undefined' && typeof input.recovery !== 'boolean')
      reject(400, '验证方式无效');
    const row = currentUser ? null : tokenRow(input.token);
    const user = currentUser
      ? findUserById(db, currentUser.id)
      : row && findUserById(db, row.user_id);
    if (!user || user.status !== 'active' || (!currentUser && !row))
      reject(400, '链接无效、已使用或已过期，请重新申请');
    const version = factor.state(user.id)?.session_version || 0;
    if (row && row.version !== version) reject(400, '链接无效、已使用或已过期，请重新申请');
    if (!factor.checkUnlocked(user.id)) reject(429, '尝试过于频繁，请稍后再试');
    if (currentUser) {
      const matches =
        typeof input.oldPassword === 'string' &&
        (await bcrypt.compare(input.oldPassword, user.password_hash));
      const fresh = findUserById(db, user.id);
      if (
        fresh?.status !== 'active' ||
        fresh.password_hash !== user.password_hash ||
        (factor.state(user.id)?.session_version || 0) !== version
      )
        reject(409, '安全状态已变化，请重新登录');
      if (!factor.checkUnlocked(user.id)) reject(429, '尝试过于频繁，请稍后再试');
      if (!matches) {
        factor.fail(user.id);
        reject(401, '原密码或安全验证未通过');
      }
    }
    if (await bcrypt.compare(input.newPassword, user.password_hash))
      reject(400, '新密码不能与原密码相同');
    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
    const result = db
      .transaction(() => {
        // bcrypt 的异步边界后再次核对密码、版本、凭证和锁定，防止并发改密或重放。
        const fresh = findUserById(db, user.id);
        if (
          fresh?.status !== 'active' ||
          fresh.password_hash !== user.password_hash ||
          (factor.state(user.id)?.session_version || 0) !== version ||
          (row && !tokenRow(input.token))
        )
          return 'stale';
        if (!factor.checkUnlocked(user.id)) return 'locked';
        if (
          factor.state(user.id)?.enabled &&
          !factor.consume(user.id, input.code, input.recovery === true)
        ) {
          factor.fail(user.id);
          if (row)
            db.prepare('UPDATE password_reset_tokens SET attempts=attempts+1 WHERE digest=?').run(
              row.digest,
            );
          return 'factor';
        }
        db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(
          passwordHash,
          user.id,
        );
        db.prepare('INSERT OR IGNORE INTO user_two_factor(user_id) VALUES(?)').run(user.id);
        db.prepare(
          `UPDATE user_two_factor SET session_version=session_version+1, pending_ciphertext=NULL,
        pending_session_hash=NULL,pending_expires_at=NULL,failed_attempts=0,locked_until=0 WHERE user_id=?`,
        ).run(user.id);
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(user.id);
        return 'ok';
      })
      .immediate();
    if (result === 'locked') reject(429, '尝试过于频繁，请稍后再试');
    if (result === 'factor')
      reject(401, '原密码或安全验证未通过；已启用两步验证的账号需要有效的验证码或恢复码');
    if (result !== 'ok') reject(409, '安全状态已变化，请重新登录或重新申请链接');
    send(user, 'changed');
    try {
      logger.info?.({
        event: currentUser ? 'password_changed' : 'password_reset',
        userId: user.id,
      });
    } catch {
      /* 日志故障不回滚改密。 */
    }
  }
  return { requestReset, update, drain: () => Promise.all([...pending]) };
}
module.exports = { createPasswordService };
