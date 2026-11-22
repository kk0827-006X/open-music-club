// 音乐热梗弹幕的表结构：按「歌曲 + 进度时间戳」存弹幕，飘出时机由前端按播放进度触发。
// kind 区分文字 / 语音 / 图片弹幕；语音和图片弹幕把文件存在 storage/danmaku 下，表里只记路径。
const MESSAGE_COLUMNS = `id, track_source, track_source_id, track_title, track_artist, user_id, nickname,
  content, kind, media_path, media_duration_ms, position_ms, created_at`

// 旧库升级：早期版本只有文字弹幕，这里按需补列，避免要求用户删库重建。
function ensureColumns(database) {
  const columns = new Set(
    database.prepare('PRAGMA table_info(danmaku_messages)').all().map((column) => column.name),
  )
  if (!columns.has('kind')) {
    database.exec("ALTER TABLE danmaku_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
  }
  if (!columns.has('media_path')) {
    database.exec('ALTER TABLE danmaku_messages ADD COLUMN media_path TEXT')
  }
  if (!columns.has('media_duration_ms')) {
    database.exec('ALTER TABLE danmaku_messages ADD COLUMN media_duration_ms INTEGER')
  }
}

function initializeDanmakuSchema(database) {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS danmaku_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_source TEXT NOT NULL CHECK (track_source IN ('local', 'netease')),
        track_source_id TEXT NOT NULL,
        track_title TEXT NOT NULL,
        track_artist TEXT NOT NULL DEFAULT '',
        user_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 60),
        kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice', 'image')),
        media_path TEXT,
        media_duration_ms INTEGER,
        position_ms INTEGER NOT NULL CHECK (position_ms >= 0),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `)
    // 老库的 CHECK 约束里没有 kind，ALTER 补列后由 service 保证取值合法。
    ensureColumns(database)
    database.exec(`
      CREATE INDEX IF NOT EXISTS index_danmaku_track_position
        ON danmaku_messages(track_source, track_source_id, position_ms, id);

      CREATE INDEX IF NOT EXISTS index_danmaku_user_recent
        ON danmaku_messages(user_id, created_at DESC, id DESC);
    `)
  })()
}

const PAGE_LIMIT = 500
const RECENT_LIMIT = 50

function insertMessage(database, message) {
  const row = database
    .prepare(
      `INSERT INTO danmaku_messages
        (track_source, track_source_id, track_title, track_artist, user_id, nickname,
         content, kind, media_path, media_duration_ms, position_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.trackSource,
      message.trackSourceId,
      message.trackTitle,
      message.trackArtist ?? '',
      message.userId,
      message.nickname,
      message.content,
      message.kind ?? 'text',
      message.mediaPath ?? null,
      message.mediaDurationMs ?? null,
      message.positionMs,
    )
  return Number(row.lastInsertRowid)
}

// 拉取一首歌的弹幕时间轴；afterId 支持轮询增量拉新，不重复下发旧数据。
function listTrackMessages(database, { source, sourceId, afterId = 0, limit = PAGE_LIMIT }) {
  return database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM danmaku_messages
       WHERE track_source = ? AND track_source_id = ? AND id > ?
       ORDER BY position_ms, id
       LIMIT ?`,
    )
    .all(source, sourceId, afterId, limit)
}

function countTrackMessages(database, { source, sourceId }) {
  return database
    .prepare(
      'SELECT COUNT(*) AS count FROM danmaku_messages WHERE track_source = ? AND track_source_id = ?',
    )
    .get(source, sourceId).count
}

// 全站最新弹幕：跨歌曲按 id 倒序，供实时流展示；afterId 支持轮询增量拉新。
function listRecentMessages(database, { afterId = 0, limit = RECENT_LIMIT } = {}) {
  return database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM danmaku_messages
       WHERE id > ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(afterId, limit)
}

function countTotalMessages(database) {
  return database.prepare('SELECT COUNT(*) AS count FROM danmaku_messages').get().count
}

function findMessage(database, id) {
  return database
    .prepare('SELECT id, user_id FROM danmaku_messages WHERE id = ?')
    .get(id)
}

// 用户最近一条弹幕；service 负责把 created_at 换算成毫秒做限速判断。
function latestUserMessage(database, userId) {
  return database
    .prepare(
      `SELECT id, created_at FROM danmaku_messages
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(userId)
}

// 只能删自己的弹幕；返回是否真的删除了。
function deleteOwnMessage(database, { id, userId }) {
  return database
    .prepare('DELETE FROM danmaku_messages WHERE id = ? AND user_id = ?')
    .run(id, userId).changes > 0
}

module.exports = {
  PAGE_LIMIT,
  RECENT_LIMIT,
  countTotalMessages,
  countTrackMessages,
  deleteOwnMessage,
  findMessage,
  initializeDanmakuSchema,
  insertMessage,
  latestUserMessage,
  listRecentMessages,
  listTrackMessages,
}
