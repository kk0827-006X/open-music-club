const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createAliyunDeliveryClient } = require('../src/services/aliyunDelivery.service')

const env = { ALIYUN_DM_ACCESS_KEY_ID: 'isolated-id', ALIYUN_DM_ACCESS_KEY_SECRET: 'isolated-secret' }
const input = { subject: 'unique-attempt', from: 'club@example.com', to: 'admin@example.com', startedAt: Date.now() - 60000 }
const row = { subject: input.subject, accountName: input.from, toAddress: input.to, status: 0 }
const reply = (rows, nextStart) => ({ body: { data: { mailDetail: rows }, nextStart } })

it('生产工厂可实例化真实官方客户端，查询调用由测试替换而非联网', async t => {
  const Dm = require('@alicloud/dm20151123')
  t.mock.method(Dm.default.prototype, 'senderStatisticsDetailByParamWithOptions', async function(request) {
    request.validate()
    assert.equal(this._endpoint, 'dm.aliyuncs.com')
    return reply([row])
  })
  assert.equal(await createAliyunDeliveryClient({ env }).check(input), 'delivered')
})

it('投递查询缺少独立凭据或区域不支持时关闭，不读取默认云凭据链', async () => {
  for (const config of [{}, { ...env, ALIYUN_DM_REGION_ID: 'invalid' }]) {
    const client = createAliyunDeliveryClient({ env: config, clientFactory() { throw Error('不可创建') } })
    assert.equal(client.configured, false)
    assert.equal(await client.check(input), 'unknown')
  }
})

it('官方 SDK 使用 HTTPS 固定区域，仅查询发件地址并精确匹配主题与收件人', async () => {
  let options, request, runtime
  const client = createAliyunDeliveryClient({ env, clientFactory(config) {
    options = config
    return { async senderStatisticsDetailByParamWithOptions(req, run) { request = req; runtime = run; return reply([row]) } }
  } })
  assert.equal(await client.check(input), 'delivered')
  assert.equal(options.endpoint, 'dm.aliyuncs.com')
  assert.equal(options.protocol, 'HTTPS')
  assert.equal(request.accountName, input.from)
  assert.equal(request.toAddress, undefined)
  assert.equal(request.status, undefined)
  assert.equal(runtime.autoretry, false)
  assert.equal(runtime.ignoreSSL, false)
  assert.equal(typeof request.validate, 'function')
})

it('空记录为等待、明确拒收为失败；不匹配或未知状态不能误判成功', async () => {
  for (const [rows, expected] of [[[], 'pending'], [[{ ...row, status: 4 }], 'failed'], [[{ ...row, status: 2 }], 'failed'], [[{ ...row, status: 3 }], 'failed'], [[{ ...row, status: 1 }], 'unknown'], [[{ ...row, subject: 'other' }], 'pending'], [[{ ...row, toAddress: 'other@example.com' }], 'pending'], [[{ ...row, accountName: 'other@example.com' }], 'pending'], [[row, { ...row, status: 4 }], 'unknown']]) {
    const client = createAliyunDeliveryClient({ env, clientFactory: () => ({ async senderStatisticsDetailByParamWithOptions() { return reply(rows) } }) })
    assert.equal(await client.check(input), expected)
  }
})

it('分页必须读完，异常与超时只返回未知，日志不泄露云凭据或邮箱', async () => {
  const logs = []
  for (const send of [async () => { throw Error('isolated-secret admin@example.com') }, async () => ({}), async () => reply([row], 'endless'), () => new Promise(() => {})]) {
    const client = createAliyunDeliveryClient({ env, timeoutMs: 15, logger: { warn: x => logs.push(x) }, clientFactory: () => ({ senderStatisticsDetailByParamWithOptions: send }) })
    assert.equal(await client.check(input), 'unknown')
  }
  assert.doesNotMatch(JSON.stringify(logs), /isolated|@|secret/)
  let calls = 0
  const client = createAliyunDeliveryClient({ env, clientFactory: () => ({ async senderStatisticsDetailByParamWithOptions(req) { calls++; return req.nextStart ? reply([row]) : reply([], 'next') } }) })
  assert.equal(await client.check(input), 'delivered')
  assert.equal(calls, 2)
})
