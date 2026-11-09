// 网站账号与网易云账号独立；只有后端启动入口读取真实环境配置。
function createNeteaseAuthConfig(env = process.env) {
  const mode = env.NETEASE_AUTH_MODE || 'anonymous'
  if (!['anonymous', 'phone', 'qrcode'].includes(mode)) throw new Error('NETEASE_AUTH_MODE 只能为 anonymous、phone 或 qrcode')
  if (mode === 'anonymous') return { mode }
  if (mode === 'qrcode') {
    const storage = env.NETEASE_SESSION_STORAGE || 'encrypted'
    if (!['encrypted', 'memory'].includes(storage)) throw new Error('NETEASE_SESSION_STORAGE 只能为 encrypted 或 memory')
    if (storage === 'memory') return { mode, storage }
    const encryptionKey = env.NETEASE_SESSION_ENCRYPTION_KEY
    const key = Buffer.from(encryptionKey || '', 'base64')
    if (key.length !== 32 || key.toString('base64') !== encryptionKey) throw new Error('NETEASE_SESSION_ENCRYPTION_KEY 必须为32字节标准Base64密钥')
    return { mode, storage, encryptionKey }
  }
  const phone = env.NETEASE_PHONE, password = env.NETEASE_PASSWORD
  const countrycode = env.NETEASE_COUNTRY_CODE || '86'
  if (typeof phone !== 'string' || !/^\d{5,15}$/.test(phone)) throw new Error('NETEASE_PHONE 必须为不含国家码的5～15位手机号')
  if (typeof password !== 'string' || !password.length || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error('NETEASE_PASSWORD 未配置或格式无效')
  if (typeof countrycode !== 'string' || !/^[1-9]\d{0,3}$/.test(countrycode)) throw new Error('NETEASE_COUNTRY_CODE 必须为有效数字国家码')
  return { mode, phone, password, countrycode }
}
module.exports = { createNeteaseAuthConfig }
