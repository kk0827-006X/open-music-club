function toIsoTimestamp(value) {
  if (!value) return null
  const normalized = String(value).includes('T') ? String(value) : `${value}Z`
  return new Date(normalized).toISOString()
}

function findMusicById(database, id) {
  return database
    .prepare(
      `SELECT uploaded_music.*, users.nickname AS uploader_nickname
       FROM uploaded_music
       JOIN users ON users.id = uploaded_music.uploader_id
       WHERE uploaded_music.id = ?`,
    )
    .get(id)
}

function listMusic(database) {
  return database
    .prepare(
      `SELECT uploaded_music.*, users.nickname AS uploader_nickname
       FROM uploaded_music
       JOIN users ON users.id = uploaded_music.uploader_id
       ORDER BY uploaded_music.created_at DESC, uploaded_music.id DESC`,
    )
    .all()
}

function createMusic(database, music) {
  const result = database
    .prepare(
      `INSERT INTO uploaded_music (
        title,
        artist,
        album,
        original_filename,
        stored_filename,
        file_path,
        cover_filename,
        cover_path,
        cover_mime_type,
        mime_type,
        file_size,
        duration_ms,
        uploader_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      music.title,
      music.artist,
      music.album,
      music.originalFilename,
      music.storedFilename,
      music.filePath,
      music.coverFilename,
      music.coverPath,
      music.coverMimeType,
      music.mimeType,
      music.fileSize,
      music.durationMs,
      music.uploaderId,
    )
  return findMusicById(database, result.lastInsertRowid)
}

function recordDownload(database, musicId, userId) {
  database.transaction(() => {
    database
      .prepare(
        `UPDATE uploaded_music
         SET download_count = download_count + 1
         WHERE id = ?`,
      )
      .run(musicId)
    database
      .prepare('INSERT INTO download_logs (music_id, user_id) VALUES (?, ?)')
      .run(musicId, userId)
  })()
}

function deleteMusicRecord(database, musicId) {
  return database
    .transaction(() =>
      database.prepare('DELETE FROM uploaded_music WHERE id = ?').run(musicId),
    )()
}

function toTrack(music) {
  const baseUrl = `/api/local/music/${music.id}`
  const streamUrl = `${baseUrl}/stream`
  return {
    id: music.id,
    source: 'local',
    sourceId: String(music.id),
    trackKey: `local:${music.id}`,
    title: music.title,
    artists: [{ id: null, name: music.artist }],
    album: { id: null, name: music.album },
    durationMs: music.duration_ms,
    coverUrl: music.cover_path ? `${baseUrl}/cover` : null,
    streamUrl,
    downloadUrl: `${baseUrl}/download`,
    playable: true,
    playback: { kind: 'local-stream', url: streamUrl },
    mimeType: music.mime_type,
    fileSize: music.file_size,
    downloadCount: music.download_count,
    uploadedBy: {
      id: music.uploader_id,
      nickname: music.uploader_nickname,
    },
    createdAt: toIsoTimestamp(music.created_at),
  }
}

module.exports = {
  createMusic,
  deleteMusicRecord,
  findMusicById,
  listMusic,
  recordDownload,
  toTrack,
}
