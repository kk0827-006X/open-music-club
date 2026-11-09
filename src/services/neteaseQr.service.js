const { randomBytes, createHash } = require('node:crypto')
const QRCode = require('qrcode')
const { createNeteaseSessionStore } = require('../db/neteaseSession')
const failure = (status, message) => { throw Object.assign(new Error(message), { qrError: true, status }) }
const ownerHash = value => createHash('sha256').update(value).digest('hex')
function createNeteaseQrService({ database, neteaseService, auth, now = Date.now }) {
  let pending = null, closed = false
  const enabled = auth.mode === 'qrcode' && typeof neteaseService.configureQrStore === 'function'
  if (enabled) neteaseService.configureQrStore(createNeteaseSessionStore(database, auth))
  function available() { if (closed || !enabled) failure(503, '扫码登录未启用，请检查服务器配置') }
  function current(sessionId, ticket) {
    available()
    if (!pending || pending.expiresAt <= now()) { pending = null; failure(410, '二维码已过期，请重新生成') }
    if (pending.owner !== ownerHash(sessionId) || pending.ticket !== ticket) failure(403, '扫码会话不属于当前登录，请重新生成')
    return pending
  }
  return {
    status() {
      const state = neteaseService.accountStatus?.() || { mode: auth.mode, connected: false, storage: 'memory', storageError: false }
      return { success: true, enabled, ...state }
    },
    async start(sessionId, signal) {
      available()
      if (pending && pending.expiresAt > now() && pending.owner !== ownerHash(sessionId)) failure(409, '已有管理员正在扫码，请稍后再试')
      const entry = { owner: ownerHash(sessionId), ticket: randomBytes(24).toString('base64url'), expiresAt: now() + 180000, key: '', busy: false, lastPoll: -Infinity }
      pending = entry
      const abort = () => { if (pending === entry) pending = null }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        if (signal?.aborted) failure(409, '扫码操作已结束，请重新生成')
        const result = await neteaseService.requestQr('key')
        const key = result?.body?.data?.unikey
        if (!key || typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(key)) failure(502, '二维码暂时无法生成，请稍后重试')
        entry.key = key
        const image = await QRCode.toDataURL(`https://music.163.com/login?codekey=${encodeURIComponent(key)}`)
        if (closed || pending !== entry || entry.expiresAt <= now()) failure(409, '扫码操作已结束，请重新生成')
        return { success: true, ticket: entry.ticket, qrImage: image, expiresAt: entry.expiresAt, state: 'waiting' }
      } catch (error) {
        if (pending === entry) pending = null
        if (error.qrError) throw error
        failure(502, '二维码暂时无法生成，请稍后重试')
      } finally { signal?.removeEventListener('abort', abort) }
    },
    async check(sessionId, ticket, authorize = async () => true, signal) {
      const entry = current(sessionId, ticket)
      if (!entry.key || entry.busy || now() - entry.lastPoll < 2500) failure(429, '扫码状态查询过于频繁，请稍后再试')
      entry.busy = true; entry.lastPoll = now()
      const abort = () => { if (pending === entry) pending = null }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        if (signal?.aborted) { abort(); failure(410, '扫码操作已取消') }
        const result = await neteaseService.requestQr('check', entry.key)
        if (closed || signal?.aborted || pending !== entry || entry.expiresAt <= now()) failure(410, '二维码已过期或已取消')
        if (!(await authorize())) { if (pending === entry) pending = null; failure(403, '管理员会话已失效，请重新登录') }
        if (closed || pending !== entry || entry.expiresAt <= now()) failure(410, '二维码已过期或已取消')
        const code = result?.body?.code
        if (code === 801 || code === 802) return { success: true, state: code === 801 ? 'waiting' : 'confirming' }
        pending = null
        if (code === 800) return { success: true, state: 'expired' }
        if (code !== 803) failure(502, '扫码验证暂时不可用，请重新生成二维码')
        neteaseService.acceptQrCookies(result.cookie)
        return { success: true, state: 'connected' }
      } catch (error) {
        if (pending === entry) pending = null
        if (error.qrError) throw error
        failure(502, '扫码验证暂时不可用，请重新生成二维码')
      } finally { entry.busy = false; signal?.removeEventListener('abort', abort) }
    },
    cancel(sessionId, ticket) {
      available()
      if (pending && pending.owner === ownerHash(sessionId) && pending.ticket === ticket) pending = null
      return { success: true }
    },
    logout() { available(); pending = null; neteaseService.logoutQr(); return { success: true } },
    close() { closed = true; pending = null },
  }
}
module.exports = { createNeteaseQrService }
