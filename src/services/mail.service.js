const nodemailer = require('nodemailer')

function mailbox(value, name) {
  if (typeof value !== 'string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value)) throw new Error(`${name} 必须为单个邮箱地址`)
  return value
}

// 配置来自服务端环境，不接受请求传入的收件人或服务器地址。
function createMailConfig(env = process.env) {
  if (env.MAIL_ENABLED !== undefined && !['true', 'false', ''].includes(env.MAIL_ENABLED)) throw new Error('MAIL_ENABLED 必须为 true 或 false')
  if (env.MAIL_ENABLED !== 'true') return { enabled: false }
  const host = env.SMTP_HOST
  if (!host || /[\s/:@]/.test(host)) throw new Error('SMTP_HOST 必须为服务器主机名')
  const port = Number(env.SMTP_PORT || 465)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT 无效')
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error('SMTP_USER 与 SMTP_PASSWORD 必须同时配置')
  return {
    enabled: true,
    from: mailbox(env.MAIL_FROM, 'MAIL_FROM'),
    adminTo: mailbox(env.MAIL_ADMIN_TO || env.ADMIN_EMAIL, 'MAIL_ADMIN_TO'),
    smtp: {
      host, port, secure: port === 465, requireTLS: true,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 5000,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
      logger: false, debug: false,
    },
  }
}

function createMailService({ env = process.env, transport, logger = console, sendTimeoutMs = 8000 } = {}) {
  const config = createMailConfig(env)
  const sender = config.enabled ? transport || nodemailer.createTransport(config.smtp) : null
  async function deliver(application, notification, requestId, metadata) {
    if (!sender) return 'disabled'
    let timer
    try {
      const submitted = notification === 'submitted'
      const approved = application.status === 'approved'
      const message = {
        from: config.from,
        to: submitted ? config.adminTo : mailbox(application.email, '通知邮箱'),
        subject: submitted && metadata ? metadata.subject : submitted ? 'Open Music Club：新的访问申请' : 'Open Music Club：访问申请审核结果',
        ...(submitted && metadata ? { messageId: metadata.messageId } : {}),
        // 不转发理由、密码、内部路径；纯文本也避免昵称等用户内容形成 HTML 注入。
        text: submitted
          ? `新的访问申请已保存，编号 ${application.id}。请登录管理员账号查看和审批。`
          : `你的访问申请（编号 ${application.id}）${approved ? '已通过。请通过与管理员约定的安全渠道取得初始密码。' : '未通过。需要进一步了解时请联系管理员。'}`,
        disableFileAccess: true, disableUrlAccess: true,
      }
      // 总超时覆盖任何传输实现；晚到的拒绝由 Promise.race 接管，不会成为未处理异常。
      const result = await Promise.race([
        Promise.resolve().then(() => sender.sendMail(message)),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('邮件发送超时')), sendTimeoutMs) }),
      ])
      if (result?.accepted?.includes(message.to)) return 'accepted'
      if (result?.rejected?.includes(message.to) || Array.isArray(result?.accepted) && !result.accepted.length) {
        throw Object.assign(new Error('邮件被拒收'), { code: 'EENVELOPE' })
      }
      return 'unknown'
    } catch (error) {
      // SMTP 错误可能包含凭据与收件人；只保留可关联到落库记录的安全字段。
      try { logger.warn?.({ event: 'mail_delivery_failed', applicationId: application.id, notification, requestId }) } catch { /* 日志故障同样不能回滚业务结果。 */ }
      // 只有明确拒绝或确定发生在发信前的错误才允许重试；DATA 后断线可能已被接收。
      return ['EAUTH', 'EDNS', 'ETLS', 'EENVELOPE'].includes(error?.code)
        || Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
        ? 'failed' : 'unknown'
    } finally { clearTimeout(timer) }
  }
  const legacy = async (...args) => {
    const status = await deliver(...args)
    return status === 'accepted' ? 'sent' : status === 'disabled' ? 'skipped' : 'failed'
  }
  return {
    getDeliveryConfig: () => ({ enabled: config.enabled, ...(config.enabled ? { from: config.from, adminTo: config.adminTo } : {}) }),
    submitNotification: (application, requestId, metadata) => deliver(application, 'submitted', requestId, metadata),
    applicationSubmitted: (application, requestId) => legacy(application, 'submitted', requestId),
    applicationReviewed: (application, requestId) => legacy(application, 'reviewed', requestId),
  }
}

module.exports = { createMailConfig, createMailService }
