const { randomUUID } = require('node:crypto')
const { submitApplication, findApplicationById } = require('./applications')
const { findUserByEmail } = require('./users')

function initializeApplicationNotificationSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS application_notifications (
      application_id INTEGER PRIMARY KEY REFERENCES access_requests(id) ON DELETE CASCADE,
      owner_hash TEXT NOT NULL,
      subject TEXT NOT NULL UNIQUE,
      message_id TEXT NOT NULL UNIQUE,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'pending', 'unknown', 'delivered', 'failed')),
      started_at INTEGER NOT NULL,
      next_check_at INTEGER NOT NULL DEFAULT 0,
      check_lease_token TEXT,
      check_lease_until INTEGER NOT NULL DEFAULT 0
    );
  `)
}

function findNotification(database, id) {
  return database.prepare('SELECT * FROM application_notifications WHERE application_id = ?').get(id)
}

// 同一事务决定复用、重试或创建；SMTP 只允许在事务完成后触发。
function claimNotification(database, { application, ownerHash, subject, messageId, from, to, now }) {
  return database.transaction(() => {
    if (findUserByEmail(database, application.email)) return { type: 'user_exists' }
    const existing = database.prepare("SELECT * FROM access_requests WHERE email = ? AND status = 'pending'").get(application.email)
    if (existing) {
      const notification = findNotification(database, existing.id)
      if (!notification) return { type: 'pending_exists' }
      if (notification.status !== 'failed') {
        return notification.owner_hash === ownerHash
          ? { type: 'resumed', application: existing, notification }
          : { type: 'pending_exists' }
      }
      database.prepare(`UPDATE access_requests SET nickname = ?, reason = ? WHERE id = ?`).run(application.nickname, application.reason, existing.id)
      database.prepare(`UPDATE application_notifications
        SET owner_hash = ?, subject = ?, message_id = ?, sender = ?, recipient = ?,
            status = 'sending', started_at = ?, next_check_at = 0,
            check_lease_token = NULL, check_lease_until = 0
        WHERE application_id = ? AND status = 'failed'`)
        .run(ownerHash, subject, messageId, from, to, now, existing.id)
      return { type: 'sending', application: findApplicationById(database, existing.id), notification: findNotification(database, existing.id) }
    }
    const created = submitApplication(database, application)
    if (created.type !== 'created') return created
    database.prepare(`INSERT INTO application_notifications
      (application_id, owner_hash, subject, message_id, sender, recipient, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)`)
      .run(created.application.id, ownerHash, subject, messageId, from, to, now)
    return { type: 'sending', application: created.application, notification: findNotification(database, created.application.id) }
  }).immediate()
}

function updateSendResult(database, { id, subject, status }) {
  return database.prepare(`UPDATE application_notifications SET status = ?
    WHERE application_id = ? AND subject = ? AND status = 'sending'`)
    .run(status, id, subject).changes === 1
}

function expireSending(database, { id, now, sendLeaseMs }) {
  return database.prepare(`UPDATE application_notifications SET status = 'unknown'
    WHERE application_id = ? AND status = 'sending' AND started_at <= ?`)
    .run(id, now - sendLeaseMs).changes === 1
}

function acquireCheckLease(database, { id, subject, now, cooldownMs, leaseMs }) {
  const token = randomUUID()
  const changed = database.prepare(`UPDATE application_notifications
    SET next_check_at = ?, check_lease_token = ?, check_lease_until = ?
    WHERE application_id = ? AND subject = ?
      AND status IN ('accepted', 'pending', 'unknown')
      AND next_check_at <= ? AND check_lease_until <= ?`)
    .run(now + cooldownMs, token, now + leaseMs, id, subject, now, now).changes
  return changed === 1 ? token : null
}

function finishCheck(database, { id, subject, token, status }) {
  return database.prepare(`UPDATE application_notifications
    SET status = ?, check_lease_token = NULL, check_lease_until = 0
    WHERE application_id = ? AND subject = ? AND check_lease_token = ?
      AND status IN ('accepted', 'pending', 'unknown')`)
    .run(status, id, subject, token).changes === 1
}

module.exports = {
  initializeApplicationNotificationSchema,
  findNotification,
  claimNotification,
  updateSendResult,
  expireSending,
  acquireCheckLease,
  finishCheck,
}
