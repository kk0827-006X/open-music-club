const { it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const { createUser } = require('../src/db/users');
const { createNeteaseService } = require('../src/services/netease.service');
const auth = {
  mode: 'qrcode',
  storage: 'encrypted',
  encryptionKey: Buffer.alloc(32, 17).toString('base64'),
};
async function fixture(run, check, infrastructure = {}) {
  let keyCalls = 0;
  const backend = createNeteaseService({
    auth,
    requestClient: async () => {},
    qrModules: {
      key: async () => {
        keyCalls++;
        return { body: { data: { unikey: 'mock-key' } } };
      },
      check:
        check ||
        (async () => ({
          body: { code: 803, cookie: 'private-cookie' },
          cookie: ['MUSIC_U=private-cookie; Path=/'],
        })),
    },
  });
  const app = createApp({
    infrastructure,
    databasePath: ':memory:',
    sessionSecret: 'isolated-qr-api',
    neteaseAuth: auth,
    neteaseService: backend,
    security: {
      publicOrigin: 'http://localhost',
      csrfEnabled: true,
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  const db = app.locals.database,
    hash = await bcrypt.hash('Isolated-password1!', 4);
  for (const [email, role] of [
    ['admin@example.com', 'admin'],
    ['second@example.com', 'admin'],
    ['user@example.com', 'user'],
  ])
    createUser(db, {
      email,
      role,
      nickname: '隔离账号',
      passwordHash: hash,
      mustChangePassword: false,
    });
  await backend.initialize();
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const agent = () => request.agent(server);
  const post = async (client, url, body = {}) => {
    const csrf = await client.get('/api/security/csrf-token');
    return client
      .post(url)
      .set('Origin', 'http://localhost')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(body);
  };
  const login = async (client, email = 'admin@example.com') => {
    assert.equal(
      (await post(client, '/api/auth/login', { email, password: 'Isolated-password1!' })).status,
      200,
    );
  };
  try {
    await run({ app, db, backend, server, agent, post, login, keyCalls: () => keyCalls });
  } finally {
    app.locals.neteaseQr.close();
    await backend.close();
    await new Promise((resolve) => server.close(resolve));
    app.locals.sessionStore.stopInterval?.();
    db.close();
  }
}
it('扫码管理接口拒绝未登录与普通成员，不接受绕过CSRF或跨域操作', async () =>
  fixture(async (f) => {
    const anon = f.agent(),
      user = f.agent(),
      admin = f.agent();
    assert.equal((await anon.get('/api/admin/netease-session/status')).status, 401);
    await f.login(user, 'user@example.com');
    assert.equal((await user.get('/api/admin/netease-session/status')).status, 403);
    for (const url of ['/qr', '/qr/check', '/qr/cancel', '/logout'])
      assert.equal(
        (await f.post(user, '/api/admin/netease-session' + url, { ticket: 'fake' })).status,
        403,
      );
    await f.login(admin);
    assert.equal((await admin.post('/api/admin/netease-session/qr').send({})).status, 403);
    const csrf = await admin.get('/api/security/csrf-token');
    assert.equal(
      (
        await admin
          .post('/api/admin/netease-session/qr')
          .set('Origin', 'https://evil.test')
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send({})
      ).status,
      403,
    );
    assert.equal(f.keyCalls(), 0);
  }));
it('真实隔离管理API只返回二维码和状态，登录态保留后端并加密，取消与退出生效', async () =>
  fixture(async (f) => {
    const admin = f.agent();
    await f.login(admin);
    const status = await admin.get('/api/admin/netease-session/status');
    assert.equal(status.status, 200);
    assert.match(status.headers['cache-control'], /no-store/);
    assert.equal(status.body.connected, false);
    const entry = await f.post(admin, '/api/admin/netease-session/qr');
    assert.equal(entry.status, 200);
    assert.match(entry.body.qrImage, /^data:image\/png;base64,/);
    const connected = await f.post(admin, '/api/admin/netease-session/qr/check', {
      ticket: entry.body.ticket,
    });
    assert.deepEqual(connected.body, { success: true, state: 'connected' });
    assert.doesNotMatch(JSON.stringify(connected.body), /private-cookie|MUSIC_U/);
    assert.equal((await admin.get('/api/admin/netease-session/status')).body.connected, true);
    assert.doesNotMatch(
      f.db.prepare('SELECT ciphertext FROM netease_session').get().ciphertext,
      /private-cookie/,
    );
    assert.equal((await f.post(admin, '/api/admin/netease-session/logout')).status, 200);
    assert.equal((await admin.get('/api/protected')).status, 200, '仅退出网易云，不退出网站账号');
    assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 0);
    const next = await f.post(admin, '/api/admin/netease-session/qr');
    await f.post(admin, '/api/admin/netease-session/qr/cancel', { ticket: next.body.ticket });
    assert.equal(
      (await f.post(admin, '/api/admin/netease-session/qr/check', { ticket: next.body.ticket }))
        .status,
      410,
    );
  }));
it('另一个管理员Session不能轮询或替换他人的二维码，开始接口有独立额度', async () =>
  fixture(async (f) => {
    const a = f.agent(),
      b = f.agent();
    await f.login(a);
    await f.login(b, 'second@example.com');
    const entry = await f.post(a, '/api/admin/netease-session/qr');
    assert.equal((await f.post(b, '/api/admin/netease-session/qr')).status, 409);
    assert.equal(
      (await f.post(b, '/api/admin/netease-session/qr/check', { ticket: entry.body.ticket }))
        .status,
      403,
    );
    for (let i = 0; i < 3; i++)
      assert.equal((await f.post(a, '/api/admin/netease-session/qr')).status, 200);
    assert.equal((await f.post(a, '/api/admin/netease-session/qr')).status, 429);
    assert.equal(f.keyCalls(), 4);
  }));
it('等待中的轮询在网站退出后返回成功也不能保存或复活全站身份', async () => {
  let release;
  await fixture(
    async (f) => {
      const admin = f.agent();
      await f.login(admin);
      const entry = await f.post(admin, '/api/admin/netease-session/qr');
      const pending = f.post(admin, '/api/admin/netease-session/qr/check', {
        ticket: entry.body.ticket,
      });
      for (let i = 0; !release && i < 100; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof release, 'function');
      assert.equal((await f.post(admin, '/api/auth/logout')).status, 200);
      release({ body: { code: 803 }, cookie: ['MUSIC_U=late-private-cookie'] });
      assert.equal((await pending).status, 403);
      assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 0);
      assert.equal(f.backend.accountStatus().connected, false);
    },
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
});

it('仅中断轮询HTTP而没有发送cancel时，迟到803也不能激活或持久化账号', async () => {
  let release;
  await fixture(
    async (f) => {
      const admin = f.agent();
      await f.login(admin);
      const entry = await f.post(admin, '/api/admin/netease-session/qr');
      const csrf = await admin.get('/api/security/csrf-token');
      const closed = new Promise((resolve) =>
        f.server.on('request', (req, res) => {
          if (req.url === '/api/admin/netease-session/qr/check') res.once('close', resolve);
        }),
      );
      const operation = admin
        .post('/api/admin/netease-session/qr/check')
        .set('Origin', 'http://localhost')
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ ticket: entry.body.ticket });
      const result = operation.then(
        (response) => response,
        (error) => ({ aborted: error.code === 'ABORTED' }),
      );
      for (let i = 0; !release && i < 100; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof release, 'function');
      operation.abort();
      await closed;
      assert.equal((await result).aborted, true);
      release({ body: { code: 803 }, cookie: ['MUSIC_U=late-after-disconnect'] });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.db.prepare('SELECT count(*) n FROM netease_session').get().n, 0);
      assert.equal(f.backend.accountStatus().connected, false);
    },
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
});

it('请求在异步限流期间已中断时，不生成二维码或执行后续操作', async () => {
  const { MemoryStore } = require('express-rate-limit');
  let release;
  const stores = [];
  try {
    await fixture(
      async (f) => {
        const admin = f.agent();
        await f.login(admin);
        const csrf = await admin.get('/api/security/csrf-token');
        const closed = new Promise((resolve) =>
          f.server.on('request', (req, res) => {
            if (req.url === '/api/admin/netease-session/qr') res.once('close', resolve);
          }),
        );
        const operation = admin
          .post('/api/admin/netease-session/qr')
          .set('Origin', 'http://localhost')
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send({});
        const result = operation.then(
          (response) => response,
          (error) => ({ aborted: error.code === 'ABORTED' }),
        );
        for (let i = 0; !release && i < 100; i++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(typeof release, 'function');
        operation.abort();
        await closed;
        assert.equal((await result).aborted, true);
        release();
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
        assert.equal(f.keyCalls(), 0);
      },
      undefined,
      {
        createRateLimitStore: (scope) => {
          const store = new MemoryStore();
          stores.push(store);
          if (scope === 'neteaseQrStart') {
            const increment = store.increment.bind(store);
            store.increment = async (key) => {
              await new Promise((resolve) => {
                release = resolve;
              });
              return increment(key);
            };
          }
          return store;
        },
      },
    );
  } finally {
    release?.();
    stores.forEach((store) => store.shutdown());
  }
});
