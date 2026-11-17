const assert = require('node:assert/strict');
const { beforeEach, afterEach, it } = require('node:test');
const request = require('supertest');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { MemoryStore } = require('express-rate-limit');
const { createApp } = require('../src/app');
const { createUser } = require('../src/db/users');
const { initializeSchema } = require('../src/db/database');
const { validateConfig } = require('../src/services/avatarStudio.service');
const CONFIG = {
  theme: 'moss',
  skin: 'light',
  hair: 'ink',
  body: 'body-steve',
  head: 'head-short',
  top: 'top-tshirt',
  bottom: 'bottom-overall',
  shoes: 'shoes-sneaker',
  accessory: 'acc-glasses',
};
const QUIET = { info() {}, warn() {}, error() {} };
const ORIGIN = 'https://music.example.com';
let app, owner, other, context, otherContext;
async function login(agent, email = 'owner@example.com') {
  return agent.post('/api/auth/login').send({ email, password: 'test-password' }).expect(200);
}
beforeEach(async () => {
  app = createApp({
    databasePath: ':memory:',
    sessionSecret: 'avatar-isolated-test',
    twoFactor: { encryptionKey: Buffer.alloc(32, 8).toString('base64'), now: () => 1800000000000 },
    security: { logger: QUIET },
  });
  const passwordHash = await bcrypt.hash('test-password', 4);
  for (const name of ['owner', 'other'])
    createUser(app.locals.database, {
      email: `${name}@example.com`,
      nickname: name,
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    });
  owner = request.agent(app);
  other = request.agent(app);
  await login(owner);
  await login(other, 'other@example.com');
  context = (await owner.get('/api/avatar-studio').expect(200)).body.context;
  otherContext = (await other.get('/api/avatar-studio').expect(200)).body.context;
});
afterEach(() => {
  app.locals.database.close();
  app.locals.sessionStore.stopInterval?.();
});
async function save(name = '音乐小人', config = CONFIG) {
  return (
    await owner.post('/api/avatar-studio/outfits').send({ context, name, config }).expect(201)
  ).body.outfit;
}

it('形象 CRUD、当前标记、账号隔离和级联删除', async () => {
  const first = await save(),
    second = await save('另一套', { ...CONFIG, theme: 'rose' });
  assert.notEqual(context, otherContext);
  assert.deepEqual((await other.get('/api/avatar-studio').expect(200)).body.outfits, []);
  for (const [method, suffix, payload] of [
    ['patch', '', { name: '偷改' }],
    ['delete', '', {}],
    ['post', '/current', {}],
  ]) {
    await other[method](`/api/avatar-studio/outfits/${first.id}${suffix}`)
      .send({ context: otherContext, ...payload })
      .expect(404);
  }
  await owner.post(`/api/avatar-studio/outfits/${first.id}/current`).send({ context }).expect(200);
  await owner.post(`/api/avatar-studio/outfits/${second.id}/current`).send({ context }).expect(200);
  let result = (await owner.get('/api/avatar-studio').expect(200)).body;
  assert.deepEqual(
    result.outfits.filter((item) => item.current).map((item) => item.id),
    [second.id],
  );
  assert.equal(JSON.stringify(result).includes('config_json'), false);
  await owner
    .patch(`/api/avatar-studio/outfits/${first.id}`)
    .send({ context, name: '新名称' })
    .expect(200);
  await owner.delete(`/api/avatar-studio/outfits/${second.id}`).send({ context }).expect(200);
  result = (await owner.get('/api/avatar-studio').expect(200)).body;
  assert.equal(result.outfits[0].name, '新名称');
  assert.equal(result.outfits.length, 1);
  assert.deepEqual(result.outfits[0].config, CONFIG);
  initializeSchema(app.locals.database);
  assert.equal((await owner.get('/api/avatar-studio').expect(200)).body.outfits.length, 1);
  app.locals.database.prepare('DELETE FROM users WHERE email=?').run('owner@example.com');
  assert.equal(app.locals.database.prepare('SELECT COUNT(*) AS n FROM avatar_outfits').get().n, 0);
});

it('退出、同账号重新登录和换账号后拒绝旧工坊上下文，个人形象仍持久保留', async () => {
  await save();
  await owner.post('/api/auth/logout').expect(200);
  await owner.get('/api/avatar-studio').expect(401);
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context, name: '旧草稿', config: CONFIG })
    .expect(401);
  await login(owner);
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context, name: '旧草稿', config: CONFIG })
    .expect(409);
  const fresh = (await owner.get('/api/avatar-studio').expect(200)).body;
  assert.notEqual(fresh.context, context);
  assert.equal(fresh.outfits.length, 1);
  await owner.post('/api/auth/logout').expect(200);
  await login(owner, 'other@example.com');
  const switched = (await owner.get('/api/avatar-studio').expect(200)).body;
  assert.equal(switched.outfits.length, 0);
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context: fresh.context, name: '旧草稿', config: CONFIG })
    .expect(409);
});

it('原版六槽清除可保存和恢复，空槽仅接受 null 而不接受任意标识', async () => {
  const empty = {
    ...CONFIG,
    body: null,
    head: null,
    top: null,
    bottom: null,
    shoes: null,
    accessory: null,
  };
  assert.deepEqual(validateConfig(empty), empty);
  const outfit = await save('空槽方案', empty);
  assert.deepEqual(outfit.config, empty);
  assert.deepEqual((await owner.get('/api/avatar-studio')).body.outfits[0].config, empty);
  assert.equal(validateConfig({ ...CONFIG, head: '' }), null);
  assert.equal(validateConfig({ ...CONFIG, top: 'unknown' }), null);
});

it('严格拒绝伪造用户、未知部件、SVG/颜色注入和非法名称，限制每账号 50 个形象', async () => {
  for (const config of [
    { ...CONFIG, top: '<svg onload=alert(1)>' },
    { ...CONFIG, theme: '#fff' },
    { ...CONFIG, userId: 2 },
    {},
    null,
  ]) {
    assert.equal(validateConfig(config), null);
    await owner
      .post('/api/avatar-studio/outfits')
      .send({ context, name: '无效', config })
      .expect(400);
  }
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context, name: '伪造', config: CONFIG, userId: 2 })
    .expect(400);
  for (const name of ['', 'x'.repeat(41), '\u0000'])
    await owner
      .post('/api/avatar-studio/outfits')
      .send({ context, name, config: CONFIG })
      .expect(400);
  await owner.get('/api/avatar-studio?userId=2').expect(400);
  for (let i = 0; i < 50; i++) await save(`形象${i}`);
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context, name: '超额', config: CONFIG })
    .expect(409);
  await other
    .post('/api/avatar-studio/outfits')
    .send({ context: otherContext, name: '独立额度', config: CONFIG })
    .expect(201);
});

it('密码阶段和被停用账号不能读写工坊', async () => {
  const setup = await owner
    .post('/api/auth/2fa/setup')
    .send({ password: 'test-password' })
    .expect(200);
  const { generateSync } = require('otplib');
  await owner
    .post('/api/auth/2fa/confirm')
    .send({ code: generateSync({ secret: setup.body.secret, epoch: 1800000000 }) })
    .expect(200);
  await owner.post('/api/auth/logout').expect(200);
  assert.equal((await login(owner)).body.requiresTwoFactor, true);
  await owner.get('/api/avatar-studio').expect(401);
  await owner
    .post('/api/avatar-studio/outfits')
    .send({ context, name: '无权', config: CONFIG })
    .expect(401);
  app.locals.database
    .prepare("UPDATE users SET status='disabled' WHERE email=?")
    .run('other@example.com');
  await other.get('/api/avatar-studio').expect(401);
});

it('首次建立工坊上下文时数据库异常也返回脱敏错误，不逃逸异步 Session 回调', async () => {
  const fresh = request.agent(app);
  await login(fresh);
  app.locals.database.exec('DROP TABLE avatar_outfits');
  const failed = await fresh.get('/api/avatar-studio').expect(500);
  assert.ok(failed.body.requestId);
  assert.doesNotMatch(JSON.stringify(failed.body), /SQLITE|avatar_outfits|stack/);
});

it('公网接口继承 HTTPS、Secure Cookie、CSRF、CORS 与错误脱敏', async () => {
  const secure = createApp({
    databasePath: ':memory:',
    sessionSecret: 'avatar-secure-isolated',
    security: { production: true, publicOrigin: ORIGIN, trustProxyHops: 1, logger: QUIET },
    infrastructure: {
      sessionStore: new session.MemoryStore(),
      createRateLimitStore: () => new MemoryStore(),
    },
  });
  try {
    createUser(secure.locals.database, {
      email: 'owner@example.com',
      nickname: '测试',
      passwordHash: await bcrypt.hash('test-password', 4),
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    });
    const https = (op) => op.set('X-Forwarded-Proto', 'https').set('Origin', ORIGIN);
    const token = await https(request(secure).get('/api/security/csrf-token')).expect(200);
    const logged = await https(request(secure).post('/api/auth/login'))
      .set('Cookie', token.headers['set-cookie'][0].split(';')[0])
      .set('X-CSRF-Token', token.body.csrfToken)
      .send({ email: 'owner@example.com', password: 'test-password' })
      .expect(200);
    assert.match(logged.headers['set-cookie'][0], /Secure; HttpOnly|HttpOnly; Secure/);
    const cookie = logged.headers['set-cookie'][0].split(';')[0];
    const read = await https(request(secure).get('/api/avatar-studio'))
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.ok(read.headers['strict-transport-security']);
    const csrf = await https(request(secure).get('/api/security/csrf-token'))
      .set('Cookie', cookie)
      .expect(200);
    const routes = [
      ['post', '/outfits'],
      ['patch', '/outfits/1'],
      ['delete', '/outfits/1'],
      ['post', '/outfits/1/current'],
    ];
    for (const [method, route] of routes)
      await https(request(secure)[method](`/api/avatar-studio${route}`))
        .set('Cookie', cookie)
        .send({ context: read.body.context })
        .expect(403);
    await request(secure)
      .get('/api/avatar-studio')
      .set('Cookie', cookie)
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await https(request(secure).post('/api/avatar-studio/outfits'))
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ context: read.body.context, name: '安全形象', config: CONFIG })
      .expect(201);
    secure.locals.database.exec('DROP TABLE avatar_outfits');
    const failed = await https(request(secure).get('/api/avatar-studio'))
      .set('Cookie', cookie)
      .expect(500);
    assert.ok(failed.body.requestId);
    assert.doesNotMatch(JSON.stringify(failed.body), /SQLITE|avatar_outfits|stack|database\.js/);
    await request(secure).get('/api/avatar-studio').expect(308);
  } finally {
    secure.locals.database.close();
    secure.locals.sessionStore.stopInterval?.();
  }
});

it('工坊写入复用按用户的个人数据限流，其他账号及读取不受写额度影响', async () => {
  const limited = createApp({
    databasePath: ':memory:',
    sessionSecret: 'avatar-limit-isolated',
    security: {
      logger: QUIET,
      rateLimitEnabled: true,
      rateLimits: {
        personalLibrary: { windowMs: 60000, limit: 1 },
        global: { windowMs: 60000, limit: 1000 },
      },
    },
  });
  try {
    for (const email of ['owner@example.com', 'other@example.com'])
      createUser(limited.locals.database, {
        email,
        nickname: '测试',
        passwordHash: await bcrypt.hash('test-password', 4),
        role: 'user',
        status: 'active',
        mustChangePassword: false,
      });
    const first = request.agent(limited),
      second = request.agent(limited);
    await login(first);
    await login(second, 'other@example.com');
    const a = (await first.get('/api/avatar-studio')).body.context,
      b = (await second.get('/api/avatar-studio')).body.context;
    await first
      .post('/api/avatar-studio/outfits')
      .send({ context: a, name: '首个', config: CONFIG })
      .expect(201);
    await first
      .post('/api/avatar-studio/outfits')
      .send({ context: a, name: '超额', config: CONFIG })
      .expect(429);
    await first.get('/api/avatar-studio').expect(200);
    await second
      .post('/api/avatar-studio/outfits')
      .send({ context: b, name: '其他账号', config: CONFIG })
      .expect(201);
  } finally {
    limited.locals.database.close();
    limited.locals.sessionStore.stopInterval?.();
  }
});
