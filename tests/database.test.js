const assert = require('node:assert/strict')
const { afterEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')

const {
  createDatabase,
  initializeSchema,
} = require('../src/db/database')
const { initializeAdmin } = require('../src/db/init')
const { createUser, findUserByEmail } = require('../src/db/users')

const temporaryDirectories = []

function createTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-db-'))
  temporaryDirectories.push(directory)
  const database = createDatabase(path.join(directory, 'test.sqlite'))
  initializeSchema(database)
  return database
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('数据库初始化', () => {
  it('创建包含所有必需字段的 users 表', () => {
    const database = createTestDatabase()
    const columns = database
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((column) => column.name)

    assert.deepEqual(columns, [
      'id',
      'email',
      'nickname',
      'password_hash',
      'role',
      'status',
      'must_change_password',
      'created_at',
      'updated_at',
    ])
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1)
    database.close()
  })

  it('创建默认管理员并使用 bcrypt 保存密码', async () => {
    const database = createTestDatabase()

    const result = await initializeAdmin(database, {
      email: ' Admin@Example.com ',
      password: 'admin-pass-123',
      nickname: '',
    })
    const administrator = findUserByEmail(database, 'admin@example.com')

    assert.equal(result.created, true)
    assert.equal(administrator.email, 'admin@example.com')
    assert.equal(administrator.nickname, '管理员')
    assert.equal(administrator.role, 'admin')
    assert.equal(administrator.status, 'active')
    assert.equal(administrator.must_change_password, 1)
    assert.notEqual(administrator.password_hash, 'admin-pass-123')
    assert.equal(
      await bcrypt.compare('admin-pass-123', administrator.password_hash),
      true,
    )
    database.close()
  })

  it('管理员已存在时不重复创建或覆盖密码', async () => {
    const database = createTestDatabase()
    const first = await initializeAdmin(database, {
      email: 'admin@example.com',
      password: 'first-password',
      nickname: '第一位管理员',
    })
    const originalHash = findUserByEmail(
      database,
      'admin@example.com',
    ).password_hash

    const second = await initializeAdmin(database, {
      email: 'ADMIN@example.com',
      password: 'second-password',
      nickname: '第二位管理员',
    })
    const administrator = findUserByEmail(database, 'admin@example.com')

    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(administrator.password_hash, originalHash)
    assert.equal(administrator.nickname, '第一位管理员')
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      1,
    )
    database.close()
  })

  it('拒绝缺少邮箱、缺少密码和少于 8 位的初始密码', async () => {
    const database = createTestDatabase()

    await assert.rejects(
      initializeAdmin(database, { password: 'valid-password' }),
      /ADMIN_EMAIL/,
    )
    await assert.rejects(
      initializeAdmin(database, { email: 'admin@example.com' }),
      /ADMIN_PASSWORD/,
    )
    await assert.rejects(
      initializeAdmin(database, {
        email: 'admin@example.com',
        password: 'short',
      }),
      /至少 8 位/,
    )
    database.close()
  })

  it('同邮箱已是普通用户时拒绝静默提升权限', async () => {
    const database = createTestDatabase()
    createUser(database, {
      email: 'member@example.com',
      nickname: '普通成员',
      passwordHash: 'test-hash',
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })

    await assert.rejects(
      initializeAdmin(database, {
        email: 'MEMBER@example.com',
        password: 'admin-password',
      }),
      /不是管理员/,
    )
    assert.equal(findUserByEmail(database, 'member@example.com').role, 'user')
    database.close()
  })
})
