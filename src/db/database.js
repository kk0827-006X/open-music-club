const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

function createDatabase(databasePath) {
  if (!databasePath) {
    throw new Error('DATABASE_PATH 不能为空')
  }

  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true })
  }

  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  return database
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS update_users_updated_at
    AFTER UPDATE ON users
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE users
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = OLD.id;
    END;
  `)
}

module.exports = {
  createDatabase,
  initializeSchema,
}
