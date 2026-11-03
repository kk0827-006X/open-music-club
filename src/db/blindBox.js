// 音乐盲盒的表结构：候选缓存、抽取记录、收藏与榜单统计。
// uploaded_music.genre 是盲盒做风格筛选的依据，老库在这里补列，避免重建表影响已上传记录。
function initializeBlindBoxSchema(database) {
  database.transaction(() => database.exec(`
    CREATE TABLE IF NOT EXISTS blind_box_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL,
      style TEXT NOT NULL,
      tag_source TEXT NOT NULL DEFAULT 'genre' CHECK (tag_source IN ('genre', 'keyword')),
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      cover_url TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (source, source_id, style)
    );

    CREATE INDEX IF NOT EXISTS index_blind_box_tracks_style
      ON blind_box_tracks(style, id DESC);

    CREATE TABLE IF NOT EXISTS blind_box_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      style TEXT NOT NULL,
      track_count INTEGER NOT NULL CHECK (track_count BETWEEN 1 AND 5),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS index_blind_box_draws_user
      ON blind_box_draws(user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS blind_box_draw_items (
      draw_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL,
      style TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      cover_url TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      PRIMARY KEY (draw_id, position),
      FOREIGN KEY (draw_id) REFERENCES blind_box_draws(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS index_blind_box_draw_items_track
      ON blind_box_draw_items(source, source_id);

    CREATE TABLE IF NOT EXISTS blind_box_favorites (
      user_id INTEGER NOT NULL,
      draw_id INTEGER NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, draw_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (draw_id) REFERENCES blind_box_draws(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS index_blind_box_favorites_user
      ON blind_box_favorites(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS blind_box_track_stats (
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL,
      style TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      cover_url TEXT,
      draw_count INTEGER NOT NULL DEFAULT 0 CHECK (draw_count >= 0),
      favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
      last_drawn_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source, source_id, style)
    );

    CREATE INDEX IF NOT EXISTS index_blind_box_track_stats_favorite
      ON blind_box_track_stats(style, favorite_count DESC, draw_count DESC);
  `))()

  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'uploaded_music'").all()
  if (tables.length) {
    const columns = database.prepare('PRAGMA table_info(uploaded_music)').all()
    if (!columns.some((entry) => entry.name === 'genre')) {
      database.exec('ALTER TABLE uploaded_music ADD COLUMN genre TEXT')
    }
  }
}

// 音乐盲盒的数据访问层：建表、查询与写入，抽样、风格映射等规则在 service 中。
const POOL_LIMIT = 2000
const HISTORY_LIMIT = 100

function listLocalTracks(database) {
  return database
    .prepare(
      `SELECT id, title, artist, album, genre, cover_path, duration_ms
       FROM uploaded_music
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(POOL_LIMIT)
}

function listCachedTracks(database, style) {
  if (style === 'all') {
    return database
      .prepare(
        `SELECT source, source_id, style, title, artist, album, cover_url, duration_ms
         FROM blind_box_tracks
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(POOL_LIMIT)
  }
  return database
    .prepare(
      `SELECT source, source_id, style, title, artist, album, cover_url, duration_ms
       FROM blind_box_tracks
       WHERE style = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(style, POOL_LIMIT)
}

function countCachedStyle(database, style) {
  return database
    .prepare('SELECT COUNT(*) AS count FROM blind_box_tracks WHERE style = ?')
    .get(style).count
}

function latestCachedAt(database, style) {
  const row = database
    .prepare('SELECT MAX(created_at) AS latest FROM blind_box_tracks WHERE style = ?')
    .get(style)
  return row?.latest ? Date.parse(`${String(row.latest).replace(' ', 'T')}Z`) : 0
}

function saveCachedTracks(database, tracks) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO blind_box_tracks
      (source, source_id, style, tag_source, title, artist, album, cover_url, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  return database.transaction((rows) => {
    let saved = 0
    for (const track of rows) {
      saved += insert.run(
        track.source,
        track.sourceId,
        track.style,
        track.tagSource,
        track.title,
        track.artist,
        track.album ?? null,
        track.coverUrl ?? null,
        track.durationMs ?? 0,
      ).changes
    }
    return saved
  })(tracks)
}

function recordDraw(database, { userId, style, tracks }) {
  const insertDraw = database.prepare(
    'INSERT INTO blind_box_draws (user_id, style, track_count) VALUES (?, ?, ?)',
  )
  const insertItem = database.prepare(
    `INSERT INTO blind_box_draw_items
      (draw_id, position, source, source_id, style, title, artist, album, cover_url, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const bumpStats = database.prepare(
    `INSERT INTO blind_box_track_stats
      (source, source_id, style, title, artist, album, cover_url, draw_count, favorite_count, last_drawn_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(source, source_id, style) DO UPDATE SET
       draw_count = draw_count + 1,
       last_drawn_at = CURRENT_TIMESTAMP,
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       cover_url = excluded.cover_url`,
  )
  return database.transaction(() => {
    const drawId = Number(insertDraw.run(userId, style, tracks.length).lastInsertRowid)
    tracks.forEach((track, position) => {
      insertItem.run(
        drawId,
        position,
        track.source,
        track.sourceId,
        track.style,
        track.title,
        track.artist,
        track.album ?? null,
        track.coverUrl ?? null,
        track.durationMs ?? 0,
      )
      bumpStats.run(
        track.source,
        track.sourceId,
        track.style,
        track.title,
        track.artist,
        track.album ?? null,
        track.coverUrl ?? null,
      )
    })
    pruneDraws(database, userId)
    return drawId
  })()
}

// 未收藏的历史只保留最近若干箱，避免抽取记录无限增长；收藏箱永久保留。
function pruneDraws(database, userId) {
  database
    .prepare(
      `DELETE FROM blind_box_draws
       WHERE user_id = ?
         AND id NOT IN (SELECT draw_id FROM blind_box_favorites WHERE user_id = ?)
         AND id NOT IN (
           SELECT id FROM blind_box_draws WHERE user_id = ? ORDER BY id DESC LIMIT ?
         )`,
    )
    .run(userId, userId, userId, HISTORY_LIMIT)
}

function findDraw(database, userId, drawId) {
  return database
    .prepare(
      `SELECT id, user_id, style, track_count, created_at
       FROM blind_box_draws WHERE id = ? AND user_id = ?`,
    )
    .get(drawId, userId)
}

function listDrawItems(database, drawId) {
  return database
    .prepare(
      `SELECT source, source_id, style, title, artist, album, cover_url, duration_ms
       FROM blind_box_draw_items WHERE draw_id = ? ORDER BY position`,
    )
    .all(drawId)
}

function lastDrawKeys(database, userId) {
  const row = database
    .prepare(
      `SELECT id FROM blind_box_draws WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(userId)
  if (!row) return []
  return listDrawItems(database, row.id).map(
    (item) => `${item.source}:${item.source_id}`,
  )
}

function isFavorited(database, userId, drawId) {
  return Boolean(
    database
      .prepare('SELECT 1 FROM blind_box_favorites WHERE user_id = ? AND draw_id = ?')
      .get(userId, drawId),
  )
}

function addFavorite(database, userId, drawId) {
  return database.transaction(() => {
    const created =
      database
        .prepare('INSERT OR IGNORE INTO blind_box_favorites (user_id, draw_id) VALUES (?, ?)')
        .run(userId, drawId).changes > 0
    if (created) {
      const bump = database.prepare(
        `UPDATE blind_box_track_stats SET favorite_count = favorite_count + 1
         WHERE source = ? AND source_id = ? AND style = ?`,
      )
      for (const item of listDrawItems(database, drawId)) {
        bump.run(item.source, item.source_id, item.style)
      }
    }
    return created
  })()
}

function removeFavorite(database, userId, drawId) {
  return database.transaction(() => {
    const removed =
      database
        .prepare('DELETE FROM blind_box_favorites WHERE user_id = ? AND draw_id = ?')
        .run(userId, drawId).changes > 0
    if (removed) {
      const drop = database.prepare(
        `UPDATE blind_box_track_stats
         SET favorite_count = MAX(favorite_count - 1, 0)
         WHERE source = ? AND source_id = ? AND style = ?`,
      )
      for (const item of listDrawItems(database, drawId)) {
        drop.run(item.source, item.source_id, item.style)
      }
    }
    return removed
  })()
}

function listFavoriteBoxes(database, userId, limit, offset) {
  return database
    .prepare(
      `SELECT d.id, d.style, d.track_count, d.created_at, f.created_at AS favorited_at
       FROM blind_box_favorites f
       JOIN blind_box_draws d ON d.id = f.draw_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC, d.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset)
}

function countFavorites(database, userId) {
  return database
    .prepare('SELECT COUNT(*) AS count FROM blind_box_favorites WHERE user_id = ?')
    .get(userId).count
}

function listRanking(database, { style, metric, limit }) {
  const order = metric === 'draw'
    ? 'SUM(draw_count) DESC, SUM(favorite_count) DESC'
    : 'SUM(favorite_count) DESC, SUM(draw_count) DESC'
  const filter = style === 'all' ? '' : 'WHERE style = ?'
  const parameters = style === 'all' ? [limit] : [style, limit]
  return database
    .prepare(
      `SELECT source, source_id,
         MAX(title) AS title, MAX(artist) AS artist, MAX(cover_url) AS cover_url,
         MAX(style) AS style,
         SUM(draw_count) AS draw_count, SUM(favorite_count) AS favorite_count
       FROM blind_box_track_stats
       ${filter}
       GROUP BY source, source_id
       ORDER BY ${order}, MAX(title)
       LIMIT ?`,
    )
    .all(...parameters)
}

// 本地歌曲被删除后，它的盲盒标签缓存与榜单统计必须一起清理，避免榜单指向已失效文件。
function removeTrackData(database, { source, sourceId }) {
  database
    .prepare('DELETE FROM blind_box_track_stats WHERE source = ? AND source_id = ?')
    .run(source, sourceId)
  database
    .prepare('DELETE FROM blind_box_tracks WHERE source = ? AND source_id = ?')
    .run(source, sourceId)
}

module.exports = {
  addFavorite,
  initializeBlindBoxSchema,
  countCachedStyle,
  countFavorites,
  findDraw,
  isFavorited,
  lastDrawKeys,
  latestCachedAt,
  listCachedTracks,
  listDrawItems,
  listFavoriteBoxes,
  listLocalTracks,
  listRanking,
  recordDraw,
  removeFavorite,
  removeTrackData,
  saveCachedTracks,
}
