const bcrypt = require('bcrypt')
const dotenv = require('dotenv')
const { createDatabase, initializeSchema } = require('./database')
const { createUser, findUserByEmail, normalizeEmail } = require('./users')

const BCRYPT_COST = 12

async function initializeAdmin(
  database,
  { email, password, nickname = '管理员' },
) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    throw new Error('ADMIN_EMAIL 不能为空')
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('ADMIN_PASSWORD 不能为空')
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD 至少 8 位')
  }

  const existingUser = findUserByEmail(database, normalizedEmail)
  if (existingUser) {
    if (existingUser.role !== 'admin') {
      throw new Error('ADMIN_EMAIL 对应的现有用户不是管理员，拒绝自动提升权限')
    }
    return { created: false, user: existingUser }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  const administrator = createUser(database, {
    email: normalizedEmail,
    nickname: nickname?.trim() || '管理员',
    passwordHash,
    role: 'admin',
    status: 'active',
    mustChangePassword: true,
  })

  return { created: true, user: administrator }
}

async function run() {
  dotenv.config({ quiet: true })
  const databasePath =
    process.env.DATABASE_PATH || './data/open-music-club.sqlite'
  const database = createDatabase(databasePath)

  try {
    initializeSchema(database)
    const result = await initializeAdmin(database, {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      nickname: process.env.ADMIN_NICKNAME,
    })
    console.log(result.created ? '默认管理员创建成功' : '默认管理员已存在，跳过创建')
  } finally {
    database.close()
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`数据库初始化失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  BCRYPT_COST,
  initializeAdmin,
  run,
}
