// 足迹独立保存两类来源的播放快照，不读取或修改音乐源的数据。
function initializeFootprintSchema(database) {
  database.transaction(() => database.exec(`
    CREATE TABLE IF NOT EXISTS playback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 16),
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      artist TEXT NOT NULL CHECK (length(artist) BETWEEN 1 AND 200),
      album TEXT CHECK (album IS NULL OR length(album) <= 200),
      cover_url TEXT CHECK (cover_url IS NULL OR length(cover_url) <= 600),
      duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
      played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS index_playback_events_user_played_at
      ON playback_events(user_id, played_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS index_playback_events_user_track
      ON playback_events(user_id, source, source_id, played_at DESC);
    CREATE TABLE IF NOT EXISTS footprint_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id, user_id) REFERENCES playback_events(id, user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS index_footprint_notes_user ON footprint_notes(user_id);
    CREATE TABLE IF NOT EXISTS footprint_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
      event_ids_json TEXT NOT NULL CHECK (json_valid(event_ids_json) AND json_type(event_ids_json) = 'array' AND length(event_ids_json) <= 2000),
      card_data_json TEXT NOT NULL CHECK (json_valid(card_data_json) AND json_type(card_data_json) = 'object' AND length(card_data_json) <= 20000),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS index_footprint_cards_user_created
      ON footprint_cards(user_id, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS footprint_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption TEXT NOT NULL CHECK (length(caption) <= 500),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (card_id, user_id) REFERENCES footprint_cards(id, user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS index_footprint_posts_created ON footprint_posts(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS index_footprint_posts_user_created ON footprint_posts(user_id, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS footprint_likes (
      post_id INTEGER NOT NULL REFERENCES footprint_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS index_footprint_likes_user ON footprint_likes(user_id);
    CREATE TABLE IF NOT EXISTS footprint_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES footprint_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 300),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS index_footprint_comments_post_created ON footprint_comments(post_id, created_at, id);
    CREATE INDEX IF NOT EXISTS index_footprint_comments_user ON footprint_comments(user_id);
  `))()
}

function createFootprintRepository(database) {
  const events = `SELECT e.*, n.id AS note_id, n.content AS note_content, n.updated_at AS note_updated_at
    FROM playback_events e LEFT JOIN footprint_notes n ON n.event_id=e.id AND n.user_id=e.user_id`
  const posts = `SELECT p.*, u.nickname AS author_nickname,
    (SELECT COUNT(*) FROM footprint_likes l WHERE l.post_id=p.id) AS like_count,
    (SELECT COUNT(*) FROM footprint_comments c WHERE c.post_id=p.id) AS comment_count,
    EXISTS(SELECT 1 FROM footprint_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM footprint_posts p JOIN users u ON u.id=p.user_id`
  return {
    transaction: (operation) => database.transaction(operation)(),
    countEvents: (userId) => database.prepare('SELECT COUNT(*) AS n FROM playback_events WHERE user_id=?').get(userId).n,
    recentEvent: (userId, event) => database.prepare(`SELECT id FROM playback_events WHERE user_id=? AND source=? AND source_id=?
      AND played_at > datetime('now', '-30 seconds') ORDER BY id DESC LIMIT 1`).get(userId, event.source, event.sourceId),
    addEvent(userId, event) {
      return Number(database.prepare(`INSERT INTO playback_events(user_id,source,source_id,title,artist,album,cover_url,duration_ms)
        VALUES (?,?,?,?,?,?,?,?)`).run(userId, event.source, event.sourceId, event.title, event.artist, event.album, event.coverUrl, event.durationMs).lastInsertRowid)
    },
    listEvents: (userId, limit, offset) => database.prepare(`${events} WHERE e.user_id=? ORDER BY e.played_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(userId, limit, offset),
    findEvent: (userId, id) => database.prepare(`${events} WHERE e.user_id=? AND e.id=?`).get(userId, id),
    saveNote(userId, eventId, content) {
      database.prepare(`INSERT INTO footprint_notes(user_id,event_id,content) VALUES (?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET content=excluded.content,updated_at=CURRENT_TIMESTAMP
        WHERE footprint_notes.user_id=excluded.user_id`).run(userId, eventId, content)
    },
    deleteNote: (userId, eventId) => database.prepare('DELETE FROM footprint_notes WHERE user_id=? AND event_id=?').run(userId, eventId).changes > 0,
    countCards: (userId) => database.prepare('SELECT COUNT(*) AS n FROM footprint_cards WHERE user_id=?').get(userId).n,
    createCard(userId, title, eventIds, data) {
      return Number(database.prepare('INSERT INTO footprint_cards(user_id,title,event_ids_json,card_data_json) VALUES (?,?,?,?)')
        .run(userId, title, JSON.stringify(eventIds), JSON.stringify(data)).lastInsertRowid)
    },
    listCards: (userId, limit, offset) => database.prepare('SELECT * FROM footprint_cards WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(userId, limit, offset),
    findCard: (userId, id) => database.prepare('SELECT * FROM footprint_cards WHERE user_id=? AND id=?').get(userId, id),
    deleteCard: (userId, id) => database.prepare('DELETE FROM footprint_cards WHERE user_id=? AND id=?').run(userId, id).changes > 0,
    findPost: (viewerId, id) => database.prepare(`${posts} WHERE p.id=?`).get(viewerId, id),
    findPostByCard: (cardId) => database.prepare('SELECT id FROM footprint_posts WHERE card_id=?').get(cardId),
    countPosts: () => database.prepare('SELECT COUNT(*) AS n FROM footprint_posts').get().n,
    listPosts: (viewerId, limit, offset) => database.prepare(`${posts} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`).all(viewerId, limit, offset),
    ownPosts: (userId, limit, offset) => database.prepare(`${posts} WHERE p.user_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`).all(userId, userId, limit, offset),
    createPost: (userId, cardId, caption) => Number(database.prepare('INSERT INTO footprint_posts(user_id,card_id,caption) VALUES (?,?,?)').run(userId, cardId, caption).lastInsertRowid),
    deletePost: (userId, id) => database.prepare('DELETE FROM footprint_posts WHERE user_id=? AND id=?').run(userId, id).changes > 0,
    setLiked(postId, userId, liked) {
      if (liked) database.prepare('INSERT OR IGNORE INTO footprint_likes(post_id,user_id) VALUES (?,?)').run(postId, userId)
      else database.prepare('DELETE FROM footprint_likes WHERE post_id=? AND user_id=?').run(postId, userId)
      return database.prepare('SELECT COUNT(*) AS n FROM footprint_likes WHERE post_id=?').get(postId).n
    },
    countComments: (postId) => database.prepare('SELECT COUNT(*) AS n FROM footprint_comments WHERE post_id=?').get(postId).n,
    comments: (postId, limit, offset) => database.prepare(`SELECT c.*,u.nickname AS author_nickname FROM footprint_comments c JOIN users u ON u.id=c.user_id
      WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT ? OFFSET ?`).all(postId, limit, offset),
    addComment: (postId, userId, content) => Number(database.prepare('INSERT INTO footprint_comments(post_id,user_id,content) VALUES (?,?,?)').run(postId, userId, content).lastInsertRowid),
    deleteComment: (userId, id) => database.prepare('DELETE FROM footprint_comments WHERE user_id=? AND id=?').run(userId, id).changes > 0,
  }
}

module.exports = { initializeFootprintSchema, createFootprintRepository }
