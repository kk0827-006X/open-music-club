// 一人一条快照；0 为本地来源，1 为网易云来源，不重复存储歌曲详情或播放地址。
function readQueue(database, userId) {
  const row = database.prepare('SELECT tracks_json FROM user_playback_queues WHERE user_id = ?').get(userId)
  if (!row) return []
  return JSON.parse(row.tracks_json).map(([source, sourceId]) => ({
    source: source === 0 ? 'local' : 'netease', source_id: sourceId,
  }))
}

function saveQueue(database, userId, tracks) {
  if (tracks.length === 0) {
    database.prepare('DELETE FROM user_playback_queues WHERE user_id = ?').run(userId)
    return
  }
  const snapshot = JSON.stringify(tracks.map(track => [track.source === 'local' ? 0 : 1, track.sourceId]))
  // 单条 UPSERT 是原子操作，写入失败不会留下半份队列。
  database.prepare(`INSERT INTO user_playback_queues (user_id, tracks_json) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET tracks_json = excluded.tracks_json
    WHERE user_playback_queues.tracks_json != excluded.tracks_json`).run(userId, snapshot)
}

module.exports = { readQueue, saveQueue }
