const { it } = require('node:test')
const assert = require('node:assert/strict')
const { createMailConfig, createMailService } = require('../src/services/mail.service')

const env = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'club@example.com', MAIL_ADMIN_TO: 'admin@example.com' }
const application = { id: 42, email: 'member@example.com', nickname: '成员', status: 'pending' }

it('邮件默认关闭，不创建传输或读取未启用的 SMTP 凭据', async () => {
  const service = createMailService({ env: { SMTP_PORT: 'invalid' }, transport: { sendMail() { throw Error('不可调用') } } })
  assert.equal(await service.applicationSubmitted(application), 'skipped')
})

it('SMTP 配置校验、TLS 和固定超时，不允许头部注入或意外明文连接', () => {
  const config = createMailConfig(env)
  assert.equal(config.smtp.secure, true)
  assert.equal(config.smtp.port, 465)
  assert.equal(config.smtp.requireTLS, true)
  assert.equal(createMailConfig({ ...env, SMTP_PORT: '587' }).smtp.secure, false)
  for (const invalid of [{ MAIL_ENABLED: 'yes' }, { SMTP_PORT: '70000' }, { SMTP_HOST: 'https://smtp.example.com' }, { MAIL_FROM: 'a@example.com\r\nBcc: other@example.com' }, { MAIL_ADMIN_TO: '' }, { SMTP_USER: 'user' }]) {
    assert.throws(() => createMailConfig({ ...env, ...invalid }), /MAIL|SMTP/)
  }
})

it('真实 SMTP 适配生成纯文本通知，不发送初始密码或申请理由', async () => {
  const sent = []
  // Nodemailer 自带 jsonTransport 验证最终邮件构造，不连接公网。
  const transport = require('nodemailer').createTransport({ jsonTransport: true })
  const service = createMailService({ env, transport: { async sendMail(message) { sent.push(JSON.parse((await transport.sendMail(message)).message)); return { accepted: [message.to] } } } })
  assert.equal(await service.applicationSubmitted({ ...application, reason: '不发送的理由' }), 'sent')
  assert.equal(await service.applicationReviewed({ ...application, status: 'approved', initialPassword: '绝不能发送' }), 'sent')
  assert.equal(await service.applicationReviewed({ ...application, status: 'rejected' }), 'sent')
  assert.equal(sent[0].subject, 'Open Music Club：新的访问申请')
  assert.match(sent[1].text, /已通过/)
  assert.match(sent[2].text, /未通过/)
  assert.doesNotMatch(JSON.stringify(sent), /不发送的理由|绝不能发送/)
})

it('简化流程只发送激活链接，管理员提醒不含邮箱、理由或 Token', async () => {
  const sent = []
  const service = createMailService({ env, transport: { async sendMail(message) { sent.push(message); return { accepted: [message.to] } } } })
  const origin = 'https://club.example.com', token = 'T'.repeat(43)
  assert.equal(await service.sendAccessMessage({ ...application, status: 'approved' }, { kind: 'activate', token, subject: 'activation-subject', messageId: '<a@example.com>', origin }), 'accepted')
  assert.match(sent[0].text, /https:\/\/club\.example\.com\/activate#token=T{43}/)
  assert.match(sent[0].text, /24 小时内/)
  assert.doesNotMatch(sent[0].text, /verify-email|邮箱验证/)
  assert.equal(await service.sendAccessMessage({ ...application, status: 'pending', reason: '不发送的理由' }, { kind: 'admin', subject: 'admin-subject', messageId: '<b@example.com>', origin }), 'accepted')
  assert.match(sent[1].text, /申请已提交/)
  assert.doesNotMatch(sent[1].text, /member@example\.com|不发送的理由|#token=/)
  assert.equal(await service.sendAccessMessage({ ...application, status: 'rejected' }, { kind: 'rejected', subject: 'rejected-subject', messageId: '<c@example.com>', origin }), 'accepted')
  assert.match(sent[2].text, /未通过审核/)
  assert.doesNotMatch(JSON.stringify(sent), /verify-email|邮箱验证|不发送的理由/)
})

it('拒收、异常与超时只记脱敏事件，不向业务抛出错误', async () => {
  const logs = []
  for (const sendMail of [() => { throw Error('password /private/secret') }, async () => ({ accepted: [] }), () => new Promise(() => {})]) {
    const service = createMailService({ env, transport: { sendMail }, sendTimeoutMs: 10, logger: { warn: event => logs.push(event) } })
    assert.equal(await service.applicationSubmitted(application, 'safe-request-id'), 'failed')
  }
  assert.equal(logs.length, 3)
  assert.deepEqual(logs[0], { event: 'mail_delivery_failed', applicationId: 42, notification: 'submitted', requestId: 'safe-request-id' })
  assert.doesNotMatch(JSON.stringify(logs), /password|private|member@example.com/)
})

it('历史申请中的邮箱也只能是单个收件地址，不允许地址列表注入', async () => {
  let calls = 0
  const service = createMailService({ env, logger: { warn() {} }, transport: { async sendMail() { calls++; return { accepted: ['anything'] } } } })
  for (const email of ['a@example.com,b@example.net', 'a@example.com;other', 'a@example.com\r\nBcc: b@example.net']) {
    assert.equal(await service.applicationReviewed({ ...application, email, status: 'approved' }), 'failed')
  }
  assert.equal(calls, 0)
})

it('申请 SMTP 返回接受不等于送达，使用服务端独立主题及 Message-ID 关联', async () => {
  let sent
  const service = createMailService({ env, transport: { async sendMail(message) { sent = message; return { accepted: [message.to] } } } })
  assert.deepEqual(service.getDeliveryConfig(), { enabled: true, from: env.MAIL_FROM, adminTo: env.MAIL_ADMIN_TO })
  assert.equal(await service.submitNotification(application, 'request', { subject: 'unique-subject', messageId: '<unique@example.com>' }), 'accepted')
  assert.equal(sent.subject, 'unique-subject')
  assert.equal(sent.messageId, '<unique@example.com>')
})

it('明确 SMTP 拒绝允许重试，DATA 后断线或总超时必须保留未知', async () => {
  for (const [error, expected] of [[{ code: 'EAUTH' }, 'failed'], [{ code: 'ECONNECTION', command: 'CONN' }, 'unknown'], [{ command: 'RCPT TO', responseCode: 550 }, 'failed'], [{ command: 'DATA', responseCode: 554 }, 'failed'], [{ command: 'DATA', code: 'ETIMEDOUT' }, 'unknown'], [Error('socket close'), 'unknown']]) {
    const service = createMailService({ env, transport: { async sendMail() { throw error } }, logger: { warn() {} } })
    assert.equal(await service.submitNotification(application, 'request', { subject: 'unique', messageId: '<unique@example.com>' }), expected)
  }
  const service = createMailService({ env, transport: { sendMail: () => new Promise(() => {}) }, sendTimeoutMs: 10, logger: { warn() {} } })
  assert.equal(await service.submitNotification(application, 'request', { subject: 'unique', messageId: '<unique@example.com>' }), 'unknown')
  assert.equal(await createMailService({ env: {} }).submitNotification(application), 'disabled')
})

it('仅有可证明系统 connect 失败的 SMTP socket 错误才允许重试', async () => {
  const failures = [
    [{ code: 'ESOCKET', command: 'CONN', syscall: 'connect', errno: -61 }, 'failed'],
    [{ code: 'ESOCKET', command: 'CONN' }, 'unknown'],
    [{ code: 'ESOCKET', command: 'CONN', syscall: 'read', errno: -54 }, 'unknown'],
    [{ code: 'ESOCKET', command: 'CONN', syscall: 'write', errno: -32 }, 'unknown'],
    [{ code: 'ESOCKET', command: 'DATA', syscall: 'read', errno: -54 }, 'unknown'],
    [{ code: 'ESOCKET', command: 'DATA', syscall: 'write', errno: -32 }, 'unknown'],
  ]
  for (const [fields, expected] of failures) {
    const logs = []
    const service = createMailService({ env, logger: { warn: event => logs.push(event) }, transport: { async sendMail() {
      throw Object.assign(new Error('smtp-password member@example.com /private/secret'), fields)
    } } })
    assert.equal(await service.submitNotification(application, 'safe-request', { subject: 'socket-regression', messageId: '<socket@example.com>' }), expected, JSON.stringify(fields))
    assert.equal(logs.length, 1)
    assert.doesNotMatch(JSON.stringify(logs), /smtp-password|member@example\.com|private|syscall|errno/)
  }
})
