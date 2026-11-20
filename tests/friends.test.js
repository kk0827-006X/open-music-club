const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { afterEach, beforeEach, describe, it } = require('node:test');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createUser } = require('../src/db/users');

const ORIGIN = 'https://music.example.com';
const ROOT = '/api/me/friends';
const REQUESTS = `${ROOT}/requests`;
const INCOMING = `${REQUESTS}/incoming`;
const OUTGOING = `${REQUESTS}/outgoing`;
const SUBMITTED = { success: true, message: '申请已提交' };
const DAY_MS = 86_400_000;
const PASSWORD = '好友测试账号密码';

describe('站内好友 API', () => {
  let directory, app, database, alice, bob, admin, users, errors, applications;

  async function buildApp() {
    const instance = createApp({
      databasePath: path.join(directory, 'db.sqlite'),
      sessionSecret: 'friend-test-session-secret',
      neteaseService: {},
      localMusic: { storageRoot: path.join(directory, 'storage') },
      security: {
        production: false,
        publicOrigin: ORIGIN,
        csrfEnabled: true,
        rateLimitEnabled: true,
        logger: { error: (event) => errors.push(event) },
      },
      mail: { env: {} },
      twoFactor: { encryptionKey: null },
    });
    // 并发请求共用已监听的回环服务，避免测试客户端提前关闭临时监听。
    const server = instance.listen(0, '127.0.0.1');
    applications.push({ server, database: instance.locals.database });
    await once(server, 'listening');
    return applications.at(-1);
  }

  async function connect({ server }, member) {
    const agent = request.agent(server);
    async function csrfToken() {
      const response = await agent.get('/api/security/csrf-token').expect(200);
      return response.body.csrfToken;
    }
    let token = await csrfToken();
    if (member) {
      const login = await agent
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', token)
        .send({ email: member.email, password: PASSWORD })
        .expect(200);
      assert.equal(login.body.user.id, member.id);
      token = await csrfToken();
    }
    return {
      agent,
      send: (email) =>
        agent.post(REQUESTS).set('Origin', ORIGIN).set('X-CSRF-Token', token).send({ email }),
      reply: (id, action) =>
        agent
          .patch(`${INCOMING}/${id}`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', token)
          .send({ action }),
      delete: (url) => agent.delete(url).set('Origin', ORIGIN).set('X-CSRF-Token', token),
    };
  }

  async function incoming(client) {
    return (await client.agent.get(INCOMING).expect(200)).body.requests;
  }

  async function outgoing(client) {
    return (await client.agent.get(OUTGOING).expect(200)).body.submissions;
  }

  async function friends(client) {
    return (await client.agent.get(ROOT).expect(200)).body.friends;
  }

  async function submit(client, email) {
    await client.send(email).expect('Cache-Control', 'private, no-store').expect(202, SUBMITTED);
  }

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-friends-'));
    errors = [];
    applications = [];
    app = await buildApp();
    database = app.database;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    users = [
      ['alice@example.com', '小雨', 'user', 'active'],
      ['bob@example.com', '小林', 'user', 'active'],
      ['admin@example.com', '管理员', 'admin', 'active'],
      ['bea@elsewhere.example', '停用成员', 'user', 'disabled'],
    ].map(([email, nickname, role, status]) =>
      createUser(database, {
        email,
        nickname,
        role,
        status,
        passwordHash,
        mustChangePassword: false,
      }),
    );
    [alice, bob, admin] = await Promise.all(users.slice(0, 3).map((user) => connect(app, user)));
  });

  afterEach(async () => {
    for (const instance of applications) {
      await new Promise((resolve) => instance.server.close(resolve));
      instance.database.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('已注册、不存在、停用和自己的邮箱返回相同结果，发件箱只含脱敏提交', async () => {
    const emails = ['  BOB@EXAMPLE.COM  ', 'ben@empty.example', users[3].email, users[0].email];
    for (const email of emails) await submit(alice, email);
    const rows = await outgoing(alice);
    assert.equal(rows.length, emails.length);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'id', 'maskedEmail', 'submittedAt']);
      assert.equal(Date.parse(row.expiresAt) - Date.parse(row.submittedAt), 14 * DAY_MS);
    }
    assert.deepEqual(rows.map(({ maskedEmail }) => maskedEmail).sort(), [
      'a***@e***',
      'b***@e***',
      'b***@e***',
      'b***@e***',
    ]);
    const [delivered] = await incoming(bob);
    assert.deepEqual(Object.keys(delivered).sort(), ['expiresAt', 'id', 'nickname', 'requestedAt']);
    assert.equal(delivered.nickname, '小雨');
    assert.equal(Date.parse(delivered.expiresAt) - Date.parse(delivered.requestedAt), 14 * DAY_MS);
    assert.equal((await incoming(bob)).length, 1);
    assert.deepEqual(await incoming(alice), []);
    assert.deepEqual(await incoming(admin), []);
    assert.deepEqual(await outgoing(admin), []);
    assert.deepEqual(await friends(alice), []);
    const persisted = database.prepare('SELECT * FROM friend_request_submissions').all();
    assert.doesNotMatch(
      JSON.stringify(persisted),
      /example\.com|empty\.example|elsewhere\.example|小林/,
    );
    for (const row of persisted) assert.match(row.email_key, /^[a-f0-9]{64}$/);
  });

  it('仅接收方可以接受，接受后双方才有好友资料，任一方可解除', async () => {
    await submit(alice, users[1].email);
    const [{ id }] = await incoming(bob);
    const [submission] = await outgoing(alice);
    await alice.reply(id, 'accept').expect(404);
    await admin.reply(id, 'decline').expect(404);
    await admin.reply(id, 'accept').expect(404);
    await bob.reply(submission.id, 'accept').expect(404);
    await bob.delete(`${OUTGOING}/${submission.id}`).expect(404);
    await admin.delete(`${OUTGOING}/${submission.id}`).expect(404);
    await alice.delete(`${ROOT}/${users[1].id}`).expect(404);

    const attempts = await Promise.all([bob.reply(id, 'accept'), bob.reply(id, 'accept')]);
    assert.deepEqual(attempts.map(({ status }) => status).sort(), [204, 404]);
    assert.deepEqual(await incoming(bob), []);
    assert.deepEqual(await outgoing(alice), []);
    const [aliceFriend] = await friends(alice);
    const [bobFriend] = await friends(bob);
    assert.deepEqual(aliceFriend, {
      userId: users[1].id,
      nickname: '小林',
      acceptedAt: bobFriend.acceptedAt,
    });
    assert.deepEqual(bobFriend, {
      userId: users[0].id,
      nickname: '小雨',
      acceptedAt: aliceFriend.acceptedAt,
    });
    assert.deepEqual(await friends(admin), []);
    await admin.delete(`${ROOT}/${users[0].id}`).expect(404);

    await submit(alice, users[1].email);
    assert.deepEqual(await incoming(bob), []);
    await bob.delete(`${ROOT}/${users[0].id}`).expect(204);
    assert.deepEqual(await friends(alice), []);
    assert.deepEqual(await friends(bob), []);
    await alice.delete(`${ROOT}/${users[1].id}`).expect(404);
  });

  it('拒绝保留原回显，同方向冷却七天，冷却后可重新发送', async () => {
    await submit(alice, users[1].email);
    const [before] = await outgoing(alice);
    const [{ id }] = await incoming(bob);
    const startedAt = Date.now();
    await bob.reply(id, 'decline').expect(204);
    const retryAt = database
      .prepare('SELECT retry_at FROM friend_request_cooldowns')
      .get().retry_at;
    assert.ok(retryAt >= startedAt + 7 * DAY_MS && retryAt <= Date.now() + 7 * DAY_MS);
    assert.deepEqual(await outgoing(alice), [before]);
    assert.deepEqual(await incoming(bob), []);
    await bob.reply(id, 'accept').expect(404);

    await submit(alice, users[1].email);
    assert.equal((await outgoing(alice))[0].id, before.id);
    assert.deepEqual(await incoming(bob), []);
    await submit(bob, users[0].email);
    const [reverse] = await incoming(alice);
    assert.equal(reverse.nickname, '小林');
    const [{ id: reverseSubmission }] = await outgoing(bob);
    await bob.delete(`${OUTGOING}/${reverseSubmission}`).expect(204);

    database.prepare('UPDATE friend_request_cooldowns SET retry_at = ?').run(Date.now() - 1);
    await submit(alice, users[1].email);
    const [newRequest] = await incoming(bob);
    assert.notEqual(newRequest.id, id);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM friend_request_cooldowns').get().count,
      0,
    );
  });

  it('并发重复或交叉申请只送达一次，重复提交不改变收到的有效期', async () => {
    await Promise.all([
      submit(alice, users[1].email),
      submit(alice, users[1].email),
      submit(bob, users[0].email),
      submit(bob, users[0].email),
    ]);
    const receivedByAlice = await incoming(alice);
    const receivedByBob = await incoming(bob);
    assert.equal(receivedByAlice.length + receivedByBob.length, 1);
    assert.equal((await outgoing(alice)).length, 1);
    assert.equal((await outgoing(bob)).length, 1);
    await submit(alice, users[1].email);
    await submit(bob, users[0].email);
    assert.deepEqual(await incoming(alice), receivedByAlice);
    assert.deepEqual(await incoming(bob), receivedByBob);
    assert.deepEqual(await friends(alice), []);
  });

  it('撤回实际送达与未送达的提交均成功，已撤回请求不能再处理', async () => {
    await submit(alice, 'absent@example.com');
    await submit(alice, users[1].email);
    const [{ id: requestId }] = await incoming(bob);
    const rows = await outgoing(alice);
    const empty = rows.find(({ maskedEmail }) => maskedEmail === 'a***@e***');
    const delivered = rows.find(({ maskedEmail }) => maskedEmail === 'b***@e***');
    await alice.delete(`${OUTGOING}/${empty.id}`).expect(204);
    assert.equal((await incoming(bob)).length, 1);
    await alice.delete(`${OUTGOING}/${delivered.id}`).expect(204);
    assert.deepEqual(await incoming(bob), []);
    assert.deepEqual(await outgoing(alice), []);
    await bob.reply(requestId, 'accept').expect(404);
    await alice.delete(`${OUTGOING}/${randomUUID()}`).expect(404);
  });

  it('过期后立即不可见、不可处理，下一次提交清理旧记录', async () => {
    await submit(alice, users[1].email);
    const [{ id: requestId }] = await incoming(bob);
    const [{ id: submissionId }] = await outgoing(alice);
    database.prepare('UPDATE friend_relationships SET expires_at = ?').run(Date.now() - 1);
    database.prepare('UPDATE friend_request_submissions SET expires_at = ?').run(Date.now() - 1);
    assert.deepEqual(await incoming(bob), []);
    assert.deepEqual(await outgoing(alice), []);
    await bob.reply(requestId, 'accept').expect(404);
    await alice.delete(`${OUTGOING}/${submissionId}`).expect(404);
    await submit(alice, users[1].email);
    assert.notEqual((await incoming(bob))[0].id, requestId);
    assert.notEqual((await outgoing(alice))[0].id, submissionId);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM friend_relationships').get().count,
      1,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM friend_request_submissions').get().count,
      1,
    );
  });

  it('账号停用后隐藏待处理和已接受关系，重启保留有效关系和已有账号', async () => {
    await submit(alice, users[1].email);
    const [{ id }] = await incoming(bob);
    const setStatus = database.prepare('UPDATE users SET status = ? WHERE id = ?');
    setStatus.run('disabled', users[0].id);
    assert.deepEqual(await incoming(bob), []);
    await bob.reply(id, 'accept').expect(404);
    setStatus.run('active', users[0].id);
    await bob.reply(id, 'accept').expect(204);
    const restarted = await buildApp();
    await request(restarted.server).get('/health').expect(200, { status: 'ok' });
    const member = await connect(restarted, users[1]);
    assert.equal((await friends(member))[0].userId, users[0].id);
    setStatus.run('disabled', users[0].id);
    assert.deepEqual(await friends(member), []);
  });

  it('校验登录、同源和 CSRF，只按当前账号限流提交', async () => {
    const guest = await connect(app);
    for (const url of [ROOT, INCOMING, OUTGOING]) await guest.agent.get(url).expect(401);
    await guest.send(users[1].email).expect(401);
    await alice.agent
      .post(REQUESTS)
      .set('Origin', ORIGIN)
      .send({ email: users[1].email })
      .expect(403);
    await alice.agent
      .post(REQUESTS)
      .set('Origin', 'https://other.example')
      .send({ email: users[1].email })
      .expect(403);
    assert.deepEqual(await outgoing(alice), []);
    for (let i = 0; i < 10; i++) await submit(alice, `unknown${i}@example.com`);
    await alice.send(users[1].email).expect(429);
    await submit(bob, users[0].email);
    const [{ id }] = await incoming(alice);
    await alice.agent
      .patch(`${INCOMING}/${id}`)
      .set('Origin', ORIGIN)
      .send({ action: 'accept' })
      .expect(403);
    const [{ id: submissionId }] = await outgoing(bob);
    await bob.agent.delete(`${OUTGOING}/${submissionId}`).set('Origin', ORIGIN).expect(403);
    await alice.reply(id, 'accept').expect(204);
    await alice.agent.delete(`${ROOT}/${users[1].id}`).set('Origin', ORIGIN).expect(403);
  });

  it('校验参数、支持分页，写入失败时回滚并脱敏响应和日志', async () => {
    for (const invalid of [
      null,
      42,
      'alice',
      'a'.repeat(255) + '@example.com',
      'a\u0000b@example.com',
    ]) {
      await alice.send(invalid).expect(400);
    }
    await alice.reply('invalid', 'accept').expect(400);
    await alice.reply(randomUUID(), 'invalid').expect(400);
    await alice.delete(`${OUTGOING}/invalid`).expect(400);
    await alice.delete(`${ROOT}/000`).expect(400);
    await alice.agent.get(`${OUTGOING}?limit=0`).expect(400);
    await alice.agent.get(`${OUTGOING}?offset=-1`).expect(400);
    await alice.agent.get(`${OUTGOING}?limit=1&limit=2`).expect(400);
    await alice.agent.post(REQUESTS).type('json').send('{"email":').expect(400);

    database.exec(`CREATE TRIGGER simulate_friend_write_failure BEFORE INSERT ON friend_relationships
      BEGIN SELECT RAISE(ABORT, '内部写入位置和账号信息'); END;`);
    const failed = await alice.send(users[1].email).expect(500);
    assert.equal(failed.body.message, '服务器内部错误');
    assert.doesNotMatch(
      JSON.stringify({ body: failed.body, errors }),
      /内部写入位置|bob@example\.com|db\.sqlite/,
    );
    assert.deepEqual(await outgoing(alice), []);
    assert.deepEqual(await incoming(bob), []);
    database.exec('DROP TRIGGER simulate_friend_write_failure');

    await submit(alice, 'one@example.com');
    await submit(alice, 'two@example.com');
    const first = await alice.agent.get(`${OUTGOING}?limit=1`).expect(200);
    const second = await alice.agent.get(`${OUTGOING}?limit=1&offset=1`).expect(200);
    assert.equal(first.body.hasMore, true);
    assert.equal(second.body.hasMore, false);
    assert.equal(first.body.submissions.length, 1);
    assert.equal(second.body.submissions.length, 1);
    assert.notEqual(first.body.submissions[0].id, second.body.submissions[0].id);
  });
});
