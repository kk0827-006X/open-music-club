const assert = require('node:assert/strict')
const { afterEach, beforeEach, describe, it } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bcrypt = require('bcrypt')
const request = require('supertest')

const { createApp } = require('../src/app')
const { createUser } = require('../src/db/users')

const TEST_PASSWORD = 'test-password'

function createWave({ durationSeconds = 0.1 } = {}) {
  const sampleRate = 8000
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataLength = Math.floor(
    durationSeconds * sampleRate * channels * bytesPerSample,
  )
  const buffer = Buffer.alloc(44 + dataLength)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  return buffer
}

function binaryParser(res, callback) {
  const chunks = []
  res.on('data', (chunk) => chunks.push(chunk))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
}

describe('本地社区音乐 API', () => {
  let directory
  let databasePath
  let storageRoot
  let applications
  let app
  let database
  let memberAgent
  let otherAgent
  let adminAgent
  let metadataResult

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'open-music-local-'))
    databasePath = path.join(directory, 'database.sqlite')
    storageRoot = path.join(directory, 'storage')
    applications = []
    metadataResult = {
      title: 'Metadata 标题',
      artist: 'Metadata 歌手',
      album: 'Metadata 专辑',
      durationMs: 1250,
      picture: null,
      container: 'WAVE',
    }

    app = buildApp({
      metadataReader: async () => metadataResult,
    })
    database = app.locals.database
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4)
    createUser(database, {
      email: 'member@example.com',
      nickname: '上传者',
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })
    createUser(database, {
      email: 'other@example.com',
      nickname: '其他用户',
      passwordHash,
      role: 'user',
      status: 'active',
      mustChangePassword: false,
    })
    createUser(database, {
      email: 'admin@example.com',
      nickname: '管理员',
      passwordHash,
      role: 'admin',
      status: 'active',
      mustChangePassword: false,
    })

    memberAgent = request.agent(app)
    otherAgent = request.agent(app)
    adminAgent = request.agent(app)
    await login(memberAgent, 'member@example.com')
    await login(otherAgent, 'other@example.com')
    await login(adminAgent, 'admin@example.com')
  })

  afterEach(async () => {
    for (const currentApp of applications) {
      if (currentApp.locals.database?.open) currentApp.locals.database.close()
      if (currentApp.locals.sessionStore?.db?.open) {
        await new Promise((resolve) =>
          currentApp.locals.sessionStore.db.close(resolve),
        )
      }
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function buildApp({ metadataReader, maximumUploadMegabytes = 100 } = {}) {
    const currentApp = createApp({
      databasePath,
      sessionDatabasePath: path.join(
        directory,
        `sessions-${applications.length}.sqlite`,
      ),
      sessionSecret: 'test-session-secret',
      localMusic: {
        storageRoot,
        maximumUploadMegabytes,
        metadataReader,
      },
    })
    applications.push(currentApp)
    return currentApp
  }

  function login(agent, email) {
    return agent.post('/api/auth/login').send({
      email,
      password: TEST_PASSWORD,
    })
  }

  function upload(
    agent = memberAgent,
    {
      filename = 'original.wav',
      contentType = 'audio/wav',
      content = createWave(),
      fields = {},
    } = {},
  ) {
    let operation = agent.post('/api/local/music')
    for (const [name, value] of Object.entries(fields)) {
      operation = operation.field(name, value)
    }
    return operation.attach('file', content, { filename, contentType })
  }

  function allFiles(relativeDirectory) {
    const target = path.join(storageRoot, relativeDirectory)
    return fs.existsSync(target) ? fs.readdirSync(target) : []
  }

  it('初始化本地音乐、下载日志、外键、索引和级联删除', () => {
    const musicColumns = database
      .prepare('PRAGMA table_info(uploaded_music)')
      .all()
      .map((column) => column.name)
    const logColumns = database
      .prepare('PRAGMA table_info(download_logs)')
      .all()
      .map((column) => column.name)
    const logForeignKeys = database
      .prepare('PRAGMA foreign_key_list(download_logs)')
      .all()
    const musicIndexes = database
      .prepare('PRAGMA index_list(uploaded_music)')
      .all()
    const logIndexes = database.prepare('PRAGMA index_list(download_logs)').all()

    assert.deepEqual(musicColumns, [
      'id',
      'title',
      'artist',
      'album',
      'original_filename',
      'stored_filename',
      'file_path',
      'cover_filename',
      'cover_path',
      'cover_mime_type',
      'mime_type',
      'file_size',
      'duration_ms',
      'uploader_id',
      'download_count',
      'created_at',
    ])
    assert.deepEqual(logColumns, [
      'id',
      'music_id',
      'user_id',
      'downloaded_at',
    ])
    assert.equal(
      logForeignKeys.some(
        (key) => key.table === 'uploaded_music' && key.on_delete === 'CASCADE',
      ),
      true,
    )
    assert.equal(musicIndexes.length >= 2, true)
    assert.equal(logIndexes.length >= 2, true)
  })

  it('所有本地音乐接口都要求登录', async () => {
    const visitor = request(app)
    const operations = [
      visitor.get('/api/local/music'),
      visitor.get('/api/local/music/1'),
      visitor.get('/api/local/music/1/cover'),
      visitor.get('/api/local/music/1/stream'),
      visitor.get('/api/local/music/1/download'),
      visitor.delete('/api/local/music/1'),
      visitor
        .post('/api/local/music')
        .attach('file', createWave(), 'visitor.wav'),
    ]

    const responses = await Promise.all(operations)
    assert.deepEqual(
      responses.map((response) => response.status),
      [401, 401, 401, 401, 401, 401, 401],
    )
  })

  it('上传合法音乐并返回不泄漏路径的统一 Track', async () => {
    const response = await upload(memberAgent, {
      fields: {
        title: '  表单标题  ',
        artist: '  表单歌手  ',
        album: '  表单专辑  ',
        source: 'netease',
        uploader_id: '999',
        download_count: '999',
      },
    })

    assert.equal(response.status, 201)
    assert.equal(response.body.success, true)
    assert.deepEqual(response.body.track, {
      id: 1,
      source: 'local',
      sourceId: '1',
      trackKey: 'local:1',
      title: '表单标题',
      artists: [{ id: null, name: '表单歌手' }],
      album: { id: null, name: '表单专辑' },
      durationMs: 1250,
      coverUrl: null,
      streamUrl: '/api/local/music/1/stream',
      downloadUrl: '/api/local/music/1/download',
      playable: true,
      playback: {
        kind: 'local-stream',
        url: '/api/local/music/1/stream',
      },
      mimeType: 'audio/wav',
      fileSize: createWave().length,
      downloadCount: 0,
      uploadedBy: { id: 1, nickname: '上传者' },
      createdAt: response.body.track.createdAt,
    })
    assert.match(response.body.track.createdAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.doesNotMatch(JSON.stringify(response.body), /file_path|stored_filename/)

    const stored = database.prepare('SELECT * FROM uploaded_music').get()
    assert.equal(stored.uploader_id, 1)
    assert.equal(stored.download_count, 0)
    assert.match(stored.file_path, /^music\/[0-9a-f-]+\.wav$/)
    assert.notEqual(stored.stored_filename, 'original.wav')
    assert.equal(fs.existsSync(path.join(storageRoot, stored.file_path)), true)
  })

  it('表单缺失时使用 Metadata，仍缺失时使用文件名和默认歌手', async () => {
    const metadataResponse = await upload()
    metadataResult = {
      title: '',
      artist: '',
      album: '',
      durationMs: 100,
      picture: null,
      container: 'WAVE',
    }
    const fallbackResponse = await upload(memberAgent, {
      filename: 'filename-title.wav',
    })

    assert.equal(metadataResponse.body.track.title, 'Metadata 标题')
    assert.equal(metadataResponse.body.track.artists[0].name, 'Metadata 歌手')
    assert.equal(metadataResponse.body.track.album.name, 'Metadata 专辑')
    assert.equal(fallbackResponse.body.track.title, 'filename-title')
    assert.equal(fallbackResponse.body.track.artists[0].name, '未知艺术家')
    assert.equal(fallbackResponse.body.track.album.name, null)
  })

  it('使用真实 music-metadata 读取 WAV 时长', async () => {
    const realApp = buildApp()
    const realAgent = request.agent(realApp)
    await login(realAgent, 'member@example.com')

    const response = await upload(realAgent, {
      filename: 'duration.wav',
      content: createWave({ durationSeconds: 0.25 }),
    })

    assert.equal(response.status, 201)
    assert.equal(response.body.track.durationMs, 250)
  })

  it('提取内嵌封面并通过受保护接口流式读取', async () => {
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    metadataResult.picture = {
      data: picture,
      mimeType: 'image/png',
      extension: '.png',
    }
    const uploaded = await upload()

    assert.equal(uploaded.body.track.coverUrl, '/api/local/music/1/cover')
    const cover = await memberAgent
      .get(uploaded.body.track.coverUrl)
      .buffer(true)
      .parse(binaryParser)
    assert.equal(cover.status, 200)
    assert.equal(cover.headers['content-type'], 'image/png')
    assert.deepEqual(cover.body, picture)
  })

  it('列表和详情返回 Track，无封面接口返回 404', async () => {
    await upload(memberAgent, { filename: 'first.wav' })
    await upload(memberAgent, { filename: 'second.wav' })

    const list = await memberAgent.get('/api/local/music')
    const detail = await memberAgent.get('/api/local/music/1')
    const missingDetail = await memberAgent.get('/api/local/music/999')
    const missingCover = await memberAgent.get('/api/local/music/1/cover')

    assert.equal(list.status, 200)
    assert.deepEqual(
      list.body.tracks.map((track) => track.id),
      [2, 1],
    )
    assert.equal(detail.status, 200)
    assert.equal(detail.body.track.trackKey, 'local:1')
    assert.equal(missingDetail.status, 404)
    assert.equal(missingCover.status, 404)
  })

  it('拒绝缺少文件、意外文件字段、非法扩展名、错误 MIME 和不可解析音频', async () => {
    const missing = await memberAgent.post('/api/local/music')
    const unexpected = await memberAgent
      .post('/api/local/music')
      .attach('cover', Buffer.from('x'), 'cover.png')
    const invalidExtension = await upload(memberAgent, {
      filename: 'music.exe',
      contentType: 'audio/wav',
    })
    const invalidMime = await upload(memberAgent, {
      filename: 'music.wav',
      contentType: 'application/octet-stream',
    })

    const realApp = buildApp()
    const realAgent = request.agent(realApp)
    await login(realAgent, 'member@example.com')
    const unparseable = await upload(realAgent, {
      filename: 'broken.wav',
      content: Buffer.from('not audio'),
    })

    assert.deepEqual(
      [missing, unexpected, invalidExtension, invalidMime, unparseable].map(
        (response) => response.status,
      ),
      [400, 400, 400, 400, 400],
    )
    assert.deepEqual(allFiles('temp'), [])
    assert.deepEqual(allFiles('music'), [])
  })

  it('上传超过配置限制时返回 413 且不遗留文件', async () => {
    const limitedApp = buildApp({
      metadataReader: async () => metadataResult,
      maximumUploadMegabytes: 0.00001,
    })
    const limitedAgent = request.agent(limitedApp)
    await login(limitedAgent, 'member@example.com')

    const response = await upload(limitedAgent)

    assert.equal(response.status, 413)
    assert.deepEqual(allFiles('temp'), [])
    assert.deepEqual(allFiles('music'), [])
  })

  it('非法上传大小配置会在服务创建前明确报错', () => {
    assert.throws(
      () =>
        createApp({
          databasePath: path.join(directory, 'invalid-config.sqlite'),
          sessionDatabasePath: path.join(directory, 'invalid-sessions.sqlite'),
          sessionSecret: 'test-session-secret',
          localMusic: { storageRoot, maximumUploadMegabytes: 0 },
        }),
      /MAX_UPLOAD_MB/,
    )
    assert.equal(fs.existsSync(path.join(directory, 'invalid-config.sqlite')), false)
  })

  it('封面写入失败时清理临时音乐且不写入数据库', async () => {
    metadataResult.picture = {
      data: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
      extension: '.png',
    }
    const coversDirectory = path.join(storageRoot, 'covers')
    fs.rmSync(coversDirectory, { recursive: true, force: true })
    fs.writeFileSync(coversDirectory, '阻止创建封面文件')

    const response = await upload()

    assert.equal(response.status, 500)
    assert.deepEqual(allFiles('temp'), [])
    assert.deepEqual(allFiles('music'), [])
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM uploaded_music').get()
        .count,
      0,
    )
  })

  it('Metadata 或数据库写入失败时清理临时及最终文件', async () => {
    const failingMetadataApp = buildApp({
      metadataReader: async () => {
        throw new Error('metadata failed')
      },
    })
    const failingMetadataAgent = request.agent(failingMetadataApp)
    await login(failingMetadataAgent, 'member@example.com')
    const metadataFailure = await upload(failingMetadataAgent)

    database.exec(`
      CREATE TRIGGER fail_music_insert
      BEFORE INSERT ON uploaded_music
      BEGIN
        SELECT RAISE(FAIL, 'forced insert failure');
      END;
    `)
    const databaseFailure = await upload()

    assert.equal(metadataFailure.status, 400)
    assert.equal(databaseFailure.status, 500)
    assert.deepEqual(allFiles('temp'), [])
    assert.deepEqual(allFiles('music'), [])
    assert.deepEqual(allFiles('covers'), [])
  })

  it('完整播放返回 200，合法 Range 返回 206，非法 Range 返回 416', async () => {
    const audio = createWave()
    const uploaded = await upload(memberAgent, { content: audio })
    const streamUrl = uploaded.body.track.streamUrl

    const full = await memberAgent
      .get(streamUrl)
      .buffer(true)
      .parse(binaryParser)
    const partial = await memberAgent
      .get(streamUrl)
      .set('Range', 'bytes=0-9')
      .buffer(true)
      .parse(binaryParser)
    const suffix = await memberAgent
      .get(streamUrl)
      .set('Range', 'bytes=-5')
      .buffer(true)
      .parse(binaryParser)
    const invalid = await memberAgent
      .get(streamUrl)
      .set('Range', `bytes=${audio.length}-`)

    assert.equal(full.status, 200)
    assert.equal(full.headers['accept-ranges'], 'bytes')
    assert.deepEqual(full.body, audio)
    assert.equal(partial.status, 206)
    assert.equal(partial.headers['content-range'], `bytes 0-9/${audio.length}`)
    assert.equal(partial.headers['content-length'], '10')
    assert.deepEqual(partial.body, audio.subarray(0, 10))
    assert.equal(suffix.status, 206)
    assert.deepEqual(suffix.body, audio.subarray(audio.length - 5))
    assert.equal(invalid.status, 416)
    assert.equal(invalid.headers['content-range'], `bytes */${audio.length}`)
  })

  it('下载完成后递增计数并记录当前用户', async () => {
    const uploaded = await upload()
    const response = await otherAgent
      .get(uploaded.body.track.downloadUrl)
      .buffer(true)
      .parse(binaryParser)

    assert.equal(response.status, 200)
    assert.match(response.headers['content-disposition'], /attachment/)
    assert.equal(
      database.prepare('SELECT download_count FROM uploaded_music').get()
        .download_count,
      1,
    )
    assert.deepEqual(
      database
        .prepare('SELECT music_id, user_id FROM download_logs')
        .get(),
      { music_id: 1, user_id: 2 },
    )
  })

  it('上传者可以删除并清理音乐、封面、记录和下载日志', async () => {
    metadataResult.picture = {
      data: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
      extension: '.png',
    }
    const uploaded = await upload()
    await otherAgent.get(uploaded.body.track.downloadUrl)

    const response = await memberAgent.delete('/api/local/music/1')

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { success: true })
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM uploaded_music').get()
        .count,
      0,
    )
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM download_logs').get()
        .count,
      0,
    )
    assert.deepEqual(allFiles('music'), [])
    assert.deepEqual(allFiles('covers'), [])
  })

  it('普通用户不能删除他人音乐，管理员可以删除任意音乐', async () => {
    await upload()

    const forbidden = await otherAgent.delete('/api/local/music/1')
    const administrator = await adminAgent.delete('/api/local/music/1')

    assert.equal(forbidden.status, 403)
    assert.equal(administrator.status, 200)
  })

  it('删除数据库事务失败时恢复已暂存的文件', async () => {
    await upload()
    const stored = database.prepare('SELECT * FROM uploaded_music').get()
    database.exec(`
      CREATE TRIGGER fail_music_delete
      BEFORE DELETE ON uploaded_music
      BEGIN
        SELECT RAISE(FAIL, 'forced delete failure');
      END;
    `)

    const response = await memberAgent.delete('/api/local/music/1')

    assert.equal(response.status, 500)
    assert.equal(fs.existsSync(path.join(storageRoot, stored.file_path)), true)
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM uploaded_music').get()
        .count,
      1,
    )
  })

  it('数据库中的越界路径不能读取存储根目录外文件', async () => {
    const outsidePath = path.join(directory, 'outside.wav')
    fs.writeFileSync(outsidePath, createWave())
    database
      .prepare(
        `INSERT INTO uploaded_music (
          title, artist, original_filename, stored_filename, file_path,
          mime_type, file_size, duration_ms, uploader_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '越界文件',
        '攻击者',
        'outside.wav',
        'outside.wav',
        '../outside.wav',
        'audio/wav',
        createWave().length,
        100,
        1,
      )

    const stream = await memberAgent.get('/api/local/music/1/stream')
    const download = await memberAgent.get('/api/local/music/1/download')

    assert.equal(stream.status, 404)
    assert.equal(download.status, 404)
  })
})
