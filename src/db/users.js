function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

function findUserByEmail(database, email) {
  return database
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(normalizeEmail(email))
}

function findUserById(database, id) {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

function createUser(
  database,
  {
    email,
    nickname,
    passwordHash,
    role = 'user',
    status = 'active',
    mustChangePassword = true,
  },
) {
  const normalizedEmail = normalizeEmail(email)
  const result = database
    .prepare(
      `INSERT INTO users (
        email,
        nickname,
        password_hash,
        role,
        status,
        must_change_password
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      normalizedEmail,
      nickname,
      passwordHash,
      role,
      status,
      mustChangePassword ? 1 : 0,
    )

  return findUserById(database, result.lastInsertRowid)
}

function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    mustChangePassword: user.must_change_password === 1,
  }
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  normalizeEmail,
  toSafeUser,
}
