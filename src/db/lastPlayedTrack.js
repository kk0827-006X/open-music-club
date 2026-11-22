function readLastPlayedTrack(database, userId) {
  const saved = database
    .prepare('SELECT source, source_id FROM user_last_played_tracks WHERE user_id = ?')
    .get(userId);
  if (saved) return saved;
  // 已有账号首次使用时，沿用最近一条足迹记录作初始曲目。
  return database
    .prepare(
      `SELECT source, source_id FROM playback_events WHERE user_id = ?
      ORDER BY played_at DESC, id DESC LIMIT 1`,
    )
    .get(userId);
}

function saveLastPlayedTrack(database, userId, reference, startedAt) {
  database
    .prepare(
      `INSERT INTO user_last_played_tracks (user_id, source, source_id, started_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET source = excluded.source,
        source_id = excluded.source_id, started_at = excluded.started_at
      WHERE excluded.started_at >= user_last_played_tracks.started_at`,
    )
    .run(userId, reference.source, reference.sourceId, startedAt);
}

module.exports = { readLastPlayedTrack, saveLastPlayedTrack };
