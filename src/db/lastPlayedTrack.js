const RECENT_LIMIT = 50;

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

function readInitialRecentTracks(database, userId) {
  const events = database
    .prepare(
      `SELECT event.source, event.source_id, unixepoch(event.played_at) * 1000 AS started_at,
             1 AS estimated_start
       FROM playback_events event
       WHERE event.user_id = ? AND event.id = (
         SELECT recent.id FROM playback_events recent
         WHERE recent.user_id = event.user_id AND recent.source = event.source
           AND recent.source_id = event.source_id
         ORDER BY recent.played_at DESC, recent.id DESC LIMIT 1
       )
       ORDER BY event.played_at DESC, event.id DESC LIMIT ?`,
    )
    .all(userId, RECENT_LIMIT);
  const saved = database
    .prepare('SELECT source, source_id, started_at FROM user_last_played_tracks WHERE user_id = ?')
    .get(userId);
  if (!saved) return events;
  // 上一次开播可能尚未写入足迹，用精确时间补齐旧账号的最新曲目。
  const index = events.findIndex(
    (event) => event.source === saved.source && event.source_id === saved.source_id,
  );
  if (index >= 0) events.splice(index, 1);
  events.unshift({ ...saved, estimated_start: 0 });
  return events.sort((a, b) => b.started_at - a.started_at).slice(0, RECENT_LIMIT);
}

function readRecentPlayedTracks(database, userId) {
  const tracks = database
    .prepare(
      `SELECT source, source_id, started_at FROM user_recent_played_tracks
       WHERE user_id = ? ORDER BY started_at DESC, play_order DESC LIMIT ?`,
    )
    .all(userId, RECENT_LIMIT);
  return tracks.length ? tracks : readInitialRecentTracks(database, userId);
}

function saveLastPlayedTrack(database, userId, reference, startedAt) {
  database
    .transaction(() => {
      if (
        !database.prepare('SELECT 1 FROM user_recent_played_tracks WHERE user_id = ?').get(userId)
      ) {
        // 首次写入时只初始化当前账号，避免启动时扫描或重写整张历史表。
        const insert = database.prepare(
          `INSERT INTO user_recent_played_tracks
           (user_id, source, source_id, started_at, play_order, estimated_start)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const tracks = readInitialRecentTracks(database, userId);
        tracks.forEach((track, index) =>
          insert.run(
            userId,
            track.source,
            track.source_id,
            track.started_at,
            tracks.length - index,
            track.estimated_start,
          ),
        );
      }
      database
        .prepare(
          `INSERT INTO user_last_played_tracks (user_id, source, source_id, started_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET source = excluded.source,
        source_id = excluded.source_id, started_at = excluded.started_at
      WHERE excluded.started_at >= user_last_played_tracks.started_at`,
        )
        .run(userId, reference.source, reference.sourceId, startedAt);
      database
        .prepare(
          `INSERT INTO user_recent_played_tracks (user_id, source, source_id, started_at, play_order)
         VALUES (?, ?, ?, ?, (
           SELECT COALESCE(MAX(play_order), 0) + 1 FROM user_recent_played_tracks WHERE user_id = ?
         ))
         ON CONFLICT(user_id, source, source_id) DO UPDATE SET
           started_at = excluded.started_at, play_order = excluded.play_order, estimated_start = 0
         WHERE user_recent_played_tracks.estimated_start = 1
           OR excluded.started_at >= user_recent_played_tracks.started_at`,
        )
        .run(userId, reference.source, reference.sourceId, startedAt, userId);
      database
        .prepare(
          `DELETE FROM user_recent_played_tracks WHERE rowid IN (
           SELECT rowid FROM user_recent_played_tracks
           WHERE user_id = ? ORDER BY started_at DESC, play_order DESC LIMIT -1 OFFSET ?
         )`,
        )
        .run(userId, RECENT_LIMIT);
    })
    .immediate();
}

module.exports = { readLastPlayedTrack, readRecentPlayedTracks, saveLastPlayedTrack };
