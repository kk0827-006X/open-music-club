const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createUser } = require('../src/db/users');

const ENDPOINT = '/api/me/last-played';
const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const ORIGIN = 'http://localhost';

describe('按账号保存上一首播放曲目', () => {
  let server, database, member, other;
  let upstreamUnavailable;

  async function write(agent, path, body, method = 'put', status = 200) {
    const token = await agent.get('/api/security/csrf-token').expect(200);
    return agent[method](path)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', token.body.csrfToken)
      .send(body)
      .expect(status);
  }

  async function login(agent, email) {
    await write(agent, '/api/auth/login', { email, password: 'test-password' }, 'post');
  }

  beforeEach(async () => {
    upstreamUnavailable = false;
    const app = createApp({
      databasePath: ':memory:',
      sessionSecret: 'isolated-playback-test',
      security: { csrfEnabled: true, publicOrigin: ORIGIN, logger: { error() {}, warn() {} } },
      neteaseService: {
        async call(name, { ids }) {
          assert.equal(name, 'songDetail');
          if (upstreamUnavailable) throw new Error('/private/music.cfg');
          return {
            code: 200,
            songs: ids.split(',').map((id) => ({
              id: Number(id),
              name: `云端歌曲 ${id}`,
              dt: 180000,
              al: { picUrl: `https://p1.music.126.net/cover-${id}.jpg` },
            })),
          };
        },
      },
    });
    database = app.locals.database;
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const passwordHash = await bcrypt.hash('test-password', 4);
    for (const email of [FIRST, SECOND])
      createUser(database, {
        email,
        nickname: '测试成员',
        passwordHash,
        mustChangePassword: false,
      });
    member = request.agent(server);
    other = request.agent(server);
    await Promise.all([login(member, FIRST), login(other, SECOND)]);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  });

  it('只保存登录账号的曲目引用，失序的请求不能覆盖后来开播的歌曲', async () => {
    const now = Date.now();
    await request(server).get(ENDPOINT).expect(401);
    await member
      .get(ENDPOINT)
      .expect('Cache-Control', 'private, no-store')
      .expect(200, { success: true, track: null });
    await member
      .put(ENDPOINT)
      .send({ source: 'netease', sourceId: '13', startedAt: now })
      .expect(403);
    const first = { source: 'netease', sourceId: '13', startedAt: now };
    await write(member, ENDPOINT, { ...first, userId: 2, currentTime: 123, streamUrl: '/private' });
    await write(member, ENDPOINT, { ...first, sourceId: '12', startedAt: now - 500 });
    await write(member, ENDPOINT, { ...first, sourceId: '../12' }, 'put', 400);
    await write(member, ENDPOINT, { ...first, startedAt: 'invalid' }, 'put', 400);
    assert.deepEqual(database.prepare('SELECT * FROM user_last_played_tracks').all(), [
      { user_id: 1, source: 'netease', source_id: '13', started_at: now },
    ]);
    await other.get(ENDPOINT).expect(200, { success: true, track: null });
    await write(other, ENDPOINT, { ...first, sourceId: '27' });
    await write(member, '/api/auth/logout', {}, 'post');
    await member.get(ENDPOINT).expect(401);
    await login(member, FIRST);
    assert.equal((await member.get(ENDPOINT).expect(200)).body.track.title, '云端歌曲 13');
    await write(member, '/api/auth/logout', {}, 'post');
    await login(member, SECOND);
    assert.equal((await member.get(ENDPOINT).expect(200)).body.track.title, '云端歌曲 27');
  });

  it('兼容旧足迹、本地曲目与曲目不可用的情况', async () => {
    database.exec(`INSERT INTO uploaded_music
      (id, title, artist, original_filename, stored_filename, file_path, mime_type, file_size, duration_ms, uploader_id)
      VALUES (13, '本地歌曲', '隔离歌手', 'test.mp3', 'test.mp3', 'music/test.mp3', 'audio/mpeg', 1, 1000, 1)`);
    await write(
      member,
      '/api/footprint/events',
      {
        source: 'local',
        sourceId: '13',
        title: '旧足迹中的歌曲',
        durationMs: 1000,
      },
      'post',
      201,
    );
    const legacy = await member.get(ENDPOINT).expect(200);
    assert.equal(legacy.body.track.trackKey, 'local:13');
    assert.equal(legacy.body.track.title, '本地歌曲');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM user_last_played_tracks').get().n, 0);
    await write(member, ENDPOINT, { source: 'netease', sourceId: '13', startedAt: Date.now() });
    assert.equal((await member.get(ENDPOINT).expect(200)).body.track.trackKey, 'netease:13');
    upstreamUnavailable = true;
    await member.get(ENDPOINT).expect(200, { success: true, track: null });
    upstreamUnavailable = false;
    assert.equal((await member.get(ENDPOINT).expect(200)).body.track.trackKey, 'netease:13');
    await write(member, ENDPOINT, { source: 'local', sourceId: '13', startedAt: Date.now() });
    database.exec('DELETE FROM uploaded_music WHERE id = 13');
    await member.get(ENDPOINT).expect(200, { success: true, track: null });
  });

  it('最近播放按账号合并历史和快速重播，最多保留 50 首且保留来源身份', async () => {
    const recentPath = '/api/me/recent-played';
    const summaryPath = '/api/me/archive-collections';
    const event = database.prepare(
      `INSERT INTO playback_events (user_id, source, source_id, title, artist, duration_ms, played_at)
       VALUES (?, ?, ?, '旧歌曲', '隔离歌手', 1000, '2025-11-01 12:00:00')`,
    );
    for (let id = 1; id <= 55; id++) event.run(1, 'netease', String(id));
    event.run(1, 'local', '55');
    event.run(1, 'netease', '55');
    event.run(2, 'netease', '999');
    database.exec(`INSERT INTO user_liked_tracks (user_id, source, source_id)
       VALUES (1, 'netease', '55'), (2, 'netease', '999'), (2, 'netease', '998')`);

    await request(server).get(recentPath).expect(401);
    await request(server).get(summaryPath).expect(401);
    const initial = (
      await member.get(recentPath).expect('Cache-Control', 'private, no-store').expect(200)
    ).body.tracks;
    assert.equal(initial.length, 50);
    assert.equal(new Set(initial.map((track) => track.trackKey)).size, 50);
    assert.deepEqual(
      initial.slice(0, 2).map((track) => track.trackKey),
      ['netease:55', 'local:55'],
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS n FROM user_recent_played_tracks').get().n,
      0,
    );

    // 足迹请求先到并使用服务器时间，也应让位给之后收到的精确开播时间。
    database
      .prepare(
        `UPDATE playback_events SET played_at = CURRENT_TIMESTAMP
                WHERE user_id = 1 AND source = 'netease' AND source_id = '12'`,
      )
      .run();
    const time = Date.now() - 5000;
    for (const [sourceId, offset] of [
      ['11', 0],
      ['12', 10],
      ['11', 20],
      ['11', 5],
    ]) {
      await write(member, ENDPOINT, {
        source: 'netease',
        sourceId,
        startedAt: time + offset,
        userId: 2,
      });
    }
    const current = (await member.get(recentPath).expect(200)).body.tracks;
    assert.equal(current.length, 50);
    assert.deepEqual(
      current.slice(0, 2).map((track) => track.trackKey),
      ['netease:11', 'netease:12'],
    );
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS n FROM user_recent_played_tracks WHERE user_id = 1')
        .get().n,
      50,
    );
    const collection = await member
      .get(summaryPath)
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    assert.equal(collection.body.favoritesCount, 1);
    assert.deepEqual(collection.body.recent, {
      count: 50,
      coverUrl: 'https://p1.music.126.net/cover-11.jpg',
    });
    assert.deepEqual(
      (await other.get(recentPath).expect(200)).body.tracks.map((track) => track.sourceId),
      ['999'],
    );
    assert.equal((await other.get(summaryPath).expect(200)).body.favoritesCount, 2);
  });
});
