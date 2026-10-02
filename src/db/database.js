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

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      avatar_data BLOB NOT NULL CHECK (length(avatar_data) BETWEEN 1 AND 262144),
      avatar_version TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE,
      nickname TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_access_request_email
      ON access_requests(email)
      WHERE status = 'pending';

    CREATE INDEX IF NOT EXISTS index_access_requests_status_created_at
      ON access_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS uploaded_music (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      cover_filename TEXT,
      cover_path TEXT,
      cover_mime_type TEXT,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK (file_size >= 0),
      duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
      uploader_id INTEGER NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploader_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS index_uploaded_music_uploader
      ON uploaded_music(uploader_id);

    CREATE INDEX IF NOT EXISTS index_uploaded_music_created_at
      ON uploaded_music(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS download_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      music_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      downloaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (music_id) REFERENCES uploaded_music(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS index_download_logs_music
      ON download_logs(music_id);

    CREATE INDEX IF NOT EXISTS index_download_logs_user_downloaded_at
      ON download_logs(user_id, downloaded_at DESC);

    CREATE TABLE IF NOT EXISTS user_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      description TEXT CHECK (description IS NULL OR length(description) <= 500),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS index_user_playlists_owner_created
      ON user_playlists(owner_user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS user_playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (playlist_id) REFERENCES user_playlists(id) ON DELETE CASCADE,
      UNIQUE (playlist_id, source, source_id)
    );

    CREATE INDEX IF NOT EXISTS index_user_playlist_tracks_order
      ON user_playlist_tracks(playlist_id, position, id);

    CREATE TABLE IF NOT EXISTS user_liked_tracks (
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('local', 'netease')),
      source_id TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, source, source_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS index_user_liked_tracks_created
      ON user_liked_tracks(user_id, created_at DESC);
  `)
}

module.exports = {
  createDatabase,
  initializeSchema,
}
