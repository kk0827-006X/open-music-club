const { createHash, randomUUID } = require('node:crypto')
const { findApplicationById, toApplicationSummary } = require('../db/applications')
const {
  claimNotification, findNotification, updateSendResult,
  expireSending, acquireCheckLease, finishCheck,
} = require('../db/applicationNotifications')

const FAILED_MESSAGE = '申请通知投递失败，请稍后重新提交'

function hashOwner(ownerId) {
  return createHash('sha256').update(ownerId).digest('hex')
}

// 超时只有“不确定”语义；晚到的传输结果不再修改数据库。
async function withTimeout(operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => { timer = setTimeout(() => resolve('unknown'), timeoutMs) }),
    ])
  } catch { return 'unknown' }
  finally { clearTimeout(timer) }
}

function createAccessApplicationService({ database, mail, deliveryClient, now = Date.now, sendTimeoutMs = 10000, queryTimeoutMs = 5000 }) {
  const cooldownMs = 10000
  // 崩溃遗留发送至少等待本地总超时；恢复时只允许转为未知。
  const sendLeaseMs = Math.max(30000, sendTimeoutMs + 1000)

  async function refresh(id) {
    let notification = findNotification(database, id)
    if (!notification) return null
    if (notification.status === 'sending') {
      expireSending(database, { id, now: now(), sendLeaseMs })
      return findNotification(database, id)
    }
    if (['delivered', 'failed'].includes(notification.status)) return notification
    if (!deliveryClient.configured) return notification
    const token = acquireCheckLease(database, {
      id, subject: notification.subject, now: now(), cooldownMs,
      leaseMs: queryTimeoutMs + 1000,
    })
    if (!token) return findNotification(database, id)
    const result = await withTimeout(() => deliveryClient.check({
      subject: notification.subject, from: notification.sender,
      to: notification.recipient, startedAt: notification.started_at,
    }), queryTimeoutMs)
    const status = ['delivered', 'failed', 'pending'].includes(result) ? result : 'unknown'
    finishCheck(database, { id, subject: notification.subject, token, status })
    notification = findNotification(database, id)
    return notification
  }

  async function submit(application, ownerId, requestId) {
    const config = mail.getDeliveryConfig()
    if (!config.enabled || !deliveryClient.configured) return { type: 'unavailable' }
    const attempt = randomUUID()
    const messageDomain = config.from.slice(config.from.lastIndexOf('@') + 1)
    const claimed = claimNotification(database, {
      application, ownerHash: hashOwner(ownerId),
      subject: `Open Music Club：访问申请 ${attempt}`,
      messageId: `<omc-${attempt}@${messageDomain}>`,
      from: config.from, to: config.adminTo, now: now(),
    })
    if (claimed.type === 'resumed') {
      const owned = await getOwned(claimed.application.id, ownerId)
      return owned ? { type: 'result', ...owned } : { type: 'pending_exists' }
    }
    if (claimed.type !== 'sending') return claimed
    const { id } = claimed.application
    const { subject, message_id: messageId } = claimed.notification
    const result = await withTimeout(() => mail.submitNotification(claimed.application, requestId, { subject, messageId }), sendTimeoutMs)
    const status = ['accepted', 'failed'].includes(result) ? result : 'unknown'
    updateSendResult(database, { id, subject, status })
    if (status === 'accepted') await refresh(id)
    const notification = findNotification(database, id)
    if (notification.owner_hash !== hashOwner(ownerId)) return { type: 'pending_exists' }
    return { type: 'result', application: findApplicationById(database, id), notification }
  }

  async function getOwned(id, ownerId) {
    const notification = findNotification(database, id)
    if (!notification || !ownerId || notification.owner_hash !== hashOwner(ownerId)) return null
    await refresh(id)
    const refreshed = findNotification(database, id)
    // 查询等待期间重试可能已把申请转交给另一会话。
    if (!refreshed || refreshed.owner_hash !== hashOwner(ownerId)) return null
    return { application: findApplicationById(database, id), notification: refreshed }
  }

  return { submit, getOwned, refresh }
}

function toDeliveryResponse({ application, notification }) {
  const status = notification.status === 'accepted' ? 'pending' : notification.status
  return {
    success: status === 'delivered',
    application: toApplicationSummary(application),
    notification: { status },
    retryable: status === 'failed',
    ...(status === 'failed' ? { message: FAILED_MESSAGE } : {}),
  }
}

module.exports = { createAccessApplicationService, toDeliveryResponse }
