function listPlaylists(database, userId, limit, offset) {
  return database.prepare(`SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
    COUNT(t.id) AS track_count
    FROM user_playlists p LEFT JOIN user_playlist_tracks t ON t.playlist_id = p.id
    WHERE p.owner_user_id = ? GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(userId, limit, offset)
}

function findPlaylist(database, userId, id) {
  return database.prepare(`SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
    COUNT(t.id) AS track_count
    FROM user_playlists p LEFT JOIN user_playlist_tracks t ON t.playlist_id = p.id
    WHERE p.owner_user_id = ? AND p.id = ? GROUP BY p.id`).get(userId, id)
}

function createPlaylist(database, userId, name, description) {
  const result = database.prepare(`INSERT INTO user_playlists (owner_user_id, name, description)
    VALUES (?, ?, ?)`).run(userId, name, description)
  return findPlaylist(database, userId, result.lastInsertRowid)
}

function updatePlaylist(database, userId, id, changes) {
  const current = findPlaylist(database, userId, id)
  if (!current) return null
  database.prepare(`UPDATE user_playlists SET name = ?, description = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?`)
    .run(changes.name ?? current.name, changes.description === undefined ? current.description : changes.description, id, userId)
  return findPlaylist(database, userId, id)
}

function deletePlaylist(database, userId, id) {
  return database.prepare('DELETE FROM user_playlists WHERE id = ? AND owner_user_id = ?')
    .run(id, userId).changes > 0
}

function listPlaylistTracks(database, playlistId) {
  return database.prepare(`SELECT id, source, source_id, position, added_at
    FROM user_playlist_tracks WHERE playlist_id = ? ORDER BY position, id`).all(playlistId)
}

function hasPlaylistTrack(database, playlistId, source, sourceId) {
  return Boolean(database.prepare(`SELECT 1 FROM user_playlist_tracks
    WHERE playlist_id = ? AND source = ? AND source_id = ?`).get(playlistId, source, sourceId))
}

function addPlaylistTrack(database, playlistId, source, sourceId) {
  return database.transaction(() => {
    const existing = database.prepare(`SELECT id FROM user_playlist_tracks
      WHERE playlist_id = ? AND source = ? AND source_id = ?`).get(playlistId, source, sourceId)
    if (existing) return null
    const count = database.prepare('SELECT COUNT(*) AS count FROM user_playlist_tracks WHERE playlist_id = ?')
      .get(playlistId).count
    if (count >= 500) return false
    const position = database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM user_playlist_tracks WHERE playlist_id = ?')
      .get(playlistId).value
    const result = database.prepare(`INSERT INTO user_playlist_tracks
      (playlist_id, source, source_id, position) VALUES (?, ?, ?, ?)`).run(playlistId, source, sourceId, position)
    return Number(result.lastInsertRowid)
  })()
}

function removePlaylistTrack(database, playlistId, source, sourceId) {
  return database.prepare(`DELETE FROM user_playlist_tracks
    WHERE playlist_id = ? AND source = ? AND source_id = ?`)
    .run(playlistId, source, sourceId).changes > 0
}

function reorderPlaylistTracks(database, playlistId, trackIds) {
  return database.transaction(() => {
    const current = listPlaylistTracks(database, playlistId)
    if (current.length !== trackIds.length || new Set(trackIds).size !== trackIds.length) return false
    const currentIds = new Set(current.map((track) => track.id))
    if (trackIds.some((id) => !currentIds.has(id))) return false
    const update = database.prepare('UPDATE user_playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?')
    trackIds.forEach((id, index) => update.run(index, id, playlistId))
    return true
  })()
}

function listLikes(database, userId, limit, offset) {
  return database.prepare(`SELECT source, source_id, created_at
    FROM user_liked_tracks WHERE user_id = ? ORDER BY created_at DESC, rowid DESC
    LIMIT ? OFFSET ?`).all(userId, limit, offset)
}

function addLike(database, userId, source, sourceId) {
  database.prepare(`INSERT OR IGNORE INTO user_liked_tracks (user_id, source, source_id)
    VALUES (?, ?, ?)`).run(userId, source, sourceId)
}

function hasLike(database, userId, source, sourceId) {
  return Boolean(database.prepare(`SELECT 1 FROM user_liked_tracks
    WHERE user_id = ? AND source = ? AND source_id = ?`).get(userId, source, sourceId))
}

function removeLike(database, userId, source, sourceId) {
  database.prepare('DELETE FROM user_liked_tracks WHERE user_id = ? AND source = ? AND source_id = ?')
    .run(userId, source, sourceId)
}

module.exports = {
  addLike,
  addPlaylistTrack,
  createPlaylist,
  deletePlaylist,
  findPlaylist,
  hasLike,
  hasPlaylistTrack,
  listLikes,
  listPlaylistTracks,
  listPlaylists,
  removeLike,
  removePlaylistTrack,
  reorderPlaylistTracks,
  updatePlaylist,
}
