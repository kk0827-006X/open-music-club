const Dm = require('@alicloud/dm20151123')

// API 按分钟接受时间；杭州邮件服务以北京时间查询，使用显式偏移避免主机时区影响。
function minute(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

function createAliyunDeliveryClient({ env = process.env, logger = console, clientFactory = config => new Dm.default(config), timeoutMs = 4500 } = {}) {
  const regionId = env.ALIYUN_DM_REGION_ID || 'cn-hangzhou'
  const configured = Boolean(env.ALIYUN_DM_ACCESS_KEY_ID?.trim() && env.ALIYUN_DM_ACCESS_KEY_SECRET?.trim() && regionId === 'cn-hangzhou')
  let client
  function sdk() {
    if (!client) client = clientFactory({
      accessKeyId: env.ALIYUN_DM_ACCESS_KEY_ID, accessKeySecret: env.ALIYUN_DM_ACCESS_KEY_SECRET,
      securityToken: env.ALIYUN_DM_SECURITY_TOKEN || undefined,
      regionId, endpoint: 'dm.aliyuncs.com', protocol: 'HTTPS',
      connectTimeout: 1500, readTimeout: 2000,
    })
    return client
  }

  async function check({ subject, from, to, startedAt }) {
    if (!configured || !subject || !from || !to || !Number.isFinite(startedAt)) return 'unknown'
    const now = Date.now()
    // 超出上游保留窗口不猜测为失败，避免重复发信。
    if (startedAt > now || now - startedAt > 29 * 86400000) return 'unknown'
    let timer, expired = false
    async function query() {
      let nextStart
      const cursors = new Set(), matches = []
      for (let page = 0; page < 3 && !expired; page++) {
        const response = await sdk().senderStatisticsDetailByParamWithOptions(new Dm.SenderStatisticsDetailByParamRequest({
          accountName: from, startTime: minute(startedAt - 60000), endTime: minute(now + 60000),
          length: 100, nextStart,
        }), { autoretry: false, maxAttempts: 1, connectTimeout: 1500, readTimeout: 2000, ignoreSSL: false })
        const rows = response?.body?.data?.mailDetail
        if (!Array.isArray(rows)) return 'unknown'
        for (const row of rows) {
          if (row.subject === subject && row.accountName === from && row.toAddress === to) matches.push(row.status)
        }
        nextStart = response.body.nextStart
        if (!nextStart) {
          if (!matches.length) return 'pending'
          // 唯一尝试对应多条矛盾记录时，宁可等待人工核实。
          const statuses = new Set(matches)
          if (statuses.size !== 1) return 'unknown'
          return matches[0] === 0 ? 'delivered' : [2, 3, 4].includes(matches[0]) ? 'failed' : 'unknown'
        }
        if (typeof nextStart !== 'string' || cursors.has(nextStart)) return 'unknown'
        cursors.add(nextStart)
      }
      return 'unknown'
    }
    try {
      return await Promise.race([query(), new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve('unknown') }, timeoutMs)
      })])
    } catch {
      try { logger.warn?.({ event: 'mail_delivery_query_failed' }) } catch { /* 日志不得影响业务。 */ }
      return 'unknown'
    } finally { clearTimeout(timer) }
  }
  return { configured, check }
}

module.exports = { createAliyunDeliveryClient }
