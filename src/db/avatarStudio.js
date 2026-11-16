function initializeAvatarStudioSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS avatar_outfits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
      config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(config_json) <= 2000),
      is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS avatar_outfits_owner ON avatar_outfits(user_id, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS avatar_outfits_current ON avatar_outfits(user_id) WHERE is_current = 1;
  `);
}

function createAvatarStudioRepository(database) {
  return {
    transaction: (action) => database.transaction(action)(),
    list: (userId) =>
      database.prepare('SELECT * FROM avatar_outfits WHERE user_id=? ORDER BY id DESC').all(userId),
    find: (userId, id) =>
      database.prepare('SELECT * FROM avatar_outfits WHERE user_id=? AND id=?').get(userId, id),
    count: (userId) =>
      database.prepare('SELECT COUNT(*) AS n FROM avatar_outfits WHERE user_id=?').get(userId).n,
    add: (userId, name, config) =>
      Number(
        database
          .prepare('INSERT INTO avatar_outfits(user_id,name,config_json) VALUES(?,?,?)')
          .run(userId, name, JSON.stringify(config)).lastInsertRowid,
      ),
    rename: (userId, id, name) =>
      database
        .prepare(
          'UPDATE avatar_outfits SET name=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?',
        )
        .run(name, userId, id).changes,
    remove: (userId, id) =>
      database.prepare('DELETE FROM avatar_outfits WHERE user_id=? AND id=?').run(userId, id)
        .changes,
    select: (userId, id) => {
      database
        .prepare('UPDATE avatar_outfits SET is_current=0 WHERE user_id=? AND is_current=1')
        .run(userId);
      database
        .prepare(
          'UPDATE avatar_outfits SET is_current=1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?',
        )
        .run(userId, id);
    },
  };
}

module.exports = { initializeAvatarStudioSchema, createAvatarStudioRepository };
