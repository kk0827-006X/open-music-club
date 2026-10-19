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
