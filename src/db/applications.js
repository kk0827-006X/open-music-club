const {
  createUser,
  findUserByEmail,
  normalizeEmail,
} = require('./users')

const APPLICATION_STATUSES = new Set(['pending', 'approved', 'rejected'])

function toIsoTimestamp(value) {
  if (!value) return null

  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return new Date(normalized).toISOString()
}

function toApplicationSummary(application) {
  return {
    id: application.id,
    email: application.email,
    nickname: application.nickname,
    status: application.status,
    createdAt: toIsoTimestamp(application.created_at),
  }
}

function toApplicationDetails(application) {
  return {
    id: application.id,
    email: application.email,
    nickname: application.nickname,
    reason: application.reason,
    status: application.status,
    createdAt: toIsoTimestamp(application.created_at),
    reviewedAt: toIsoTimestamp(application.reviewed_at),
    reviewedBy: application.reviewed_by,
  }
}

function findApplicationById(database, id) {
  return database.prepare('SELECT * FROM access_requests WHERE id = ?').get(id)
}

function findPendingApplicationByEmail(database, email) {
  return database
    .prepare(
      `SELECT *
       FROM access_requests
       WHERE email = ? AND status = 'pending'`,
    )
    .get(normalizeEmail(email))
}

function createApplication(database, { email, nickname, reason = null }) {
  const result = database
    .prepare(
      `INSERT INTO access_requests (email, nickname, reason)
       VALUES (?, ?, ?)`,
    )
    .run(normalizeEmail(email), nickname, reason)

  return findApplicationById(database, result.lastInsertRowid)
}

function submitApplication(database, application) {
  const submit = database.transaction((candidate) => {
    if (findUserByEmail(database, candidate.email)) {
      return { type: 'user_exists' }
    }
    if (findPendingApplicationByEmail(database, candidate.email)) {
      return { type: 'pending_exists' }
    }

    try {
      return {
        type: 'created',
        application: createApplication(database, candidate),
      }
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { type: 'pending_exists' }
      }
      throw error
    }
  })

  return submit.immediate(application)
}

function listApplications(database, status) {
  if (status) {
    return database
      .prepare(
        `SELECT *
         FROM access_requests
         WHERE status = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(status)
  }

  return database
    .prepare(
      `SELECT *
       FROM access_requests
       ORDER BY created_at DESC, id DESC`,
    )
    .all()
}

function approveApplication(database, { id, reviewerId, passwordHash }) {
  const approve = database.transaction(() => {
    const application = findApplicationById(database, id)
    if (!application) return { type: 'not_found' }
    if (application.status !== 'pending') return { type: 'not_pending' }
    if (findUserByEmail(database, application.email)) {
      return { type: 'user_exists' }
    }

    const user = createUser(database, {
      email: application.email,
      nickname: application.nickname,
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: true,
    })

    const result = database
      .prepare(
        `UPDATE access_requests
         SET status = 'approved',
             reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
      )
      .run(reviewerId, id)

    if (result.changes !== 1) {
      throw new Error('申请状态更新失败')
    }

    return { type: 'approved', user }
  })

  return approve.immediate()
}

function rejectApplication(database, { id, reviewerId }) {
  const reject = database.transaction(() => {
    const application = findApplicationById(database, id)
    if (!application) return { type: 'not_found' }
    if (application.status !== 'pending') return { type: 'not_pending' }

    const result = database
      .prepare(
        `UPDATE access_requests
         SET status = 'rejected',
             reviewed_by = ?,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
      )
      .run(reviewerId, id)

    if (result.changes !== 1) {
      throw new Error('申请状态更新失败')
    }

    return {
      type: 'rejected',
      application: findApplicationById(database, id),
    }
  })

  return reject.immediate()
}

module.exports = {
  APPLICATION_STATUSES,
  approveApplication,
  findApplicationById,
  listApplications,
  rejectApplication,
  submitApplication,
  toApplicationDetails,
  toApplicationSummary,
}
