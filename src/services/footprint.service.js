const { createFootprintRepository } = require('../db/footprint')

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 480
const CARD_TRACK_LIMIT = 6
const CARD_NOTE_LIMIT = 3
const CARD_LIMIT = 50
const CARD_EVENT_LIMIT = 12
const EVENT_LIMIT = 100000
const COMMENT_LIMIT = 500

class FootprintError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// 与个人音乐库相同的上游域名和凭据规则；本地封面只能走受鉴权接口。
function sanitizeCoverUrl(value) {
  if (typeof value !== 'string' || value.length > 600) return null
  const cover = value.trim()
  if (/^\/api\/local\/music\/[1-9]\d*\/cover$/.test(cover)) return cover
  try {
    const url = new URL(cover)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) return null
    url.protocol = 'https:'
    return url.href.length <= 600 ? url.href : null
  } catch { return null }
}

function toEvent(row) {
  return {
    id: row.id, source: row.source, sourceId: row.source_id, trackKey: `${row.source}:${row.source_id}`,
    title: row.title, artist: row.artist, album: row.album, coverUrl: row.cover_url,
    durationMs: row.duration_ms, playedAt: row.played_at,
    note: row.note_content == null ? null : { id: row.note_id, content: row.note_content, updatedAt: row.note_updated_at },
  }
}
function toCard(row) {
  return row ? { id: row.id, title: row.title, eventIds: JSON.parse(row.event_ids_json), data: JSON.parse(row.card_data_json), createdAt: row.created_at } : null
}
function toPost(row) {
  return row ? { id: row.id, cardId: row.card_id, authorId: row.user_id, authorNickname: row.author_nickname,
    caption: row.caption, createdAt: row.created_at, likeCount: row.like_count, commentCount: row.comment_count, liked: Boolean(row.liked) } : null
}

function computeStreak(dates, today) {
  const unique = [...new Set(dates)].sort().reverse()
  const previous = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  if (!unique.length || (unique[0] !== today && unique[0] !== previous(today))) return 0
  let cursor = unique[0], count = 0
  for (const day of unique) {
    if (day !== cursor) break
    count++
    cursor = previous(cursor)
  }
  return count
}

function createFootprintService({ database, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES } = {}) {
  if (!Number.isSafeInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 1440) throw new Error('站点时区必须是 -1440 至 1440 的整数分钟')
  const repository = createFootprintRepository(database)
  // 偏移作为绑定参数传入，数据库分组与显示使用同一时区。
  const modifier = `${timezoneOffsetMinutes >= 0 ? '+' : ''}${timezoneOffsetMinutes} minutes`
  function requirePost(viewerId, id) {
    const row = repository.findPost(viewerId, id)
    if (!row) throw new FootprintError(404, '分享不存在')
    return row
  }
  function buildCardData(userId, eventIds) {
    if (!Array.isArray(eventIds) || !eventIds.length || eventIds.length > CARD_EVENT_LIMIT || new Set(eventIds.map(String)).size !== eventIds.length) throw new FootprintError(400, '所选记录无效')
    const rows = eventIds.map((id) => repository.findEvent(userId, id))
    // 必须验证每条记录，不得静默忽略他人的记录或不存在的记录。
    if (rows.some((row) => !row)) throw new FootprintError(404, '所选记录不存在')
    const ordered = rows.sort((a, b) => String(a.played_at).localeCompare(String(b.played_at)) || a.id - b.id)
    const counts = new Map()
    for (const row of ordered) {
      const key = `${row.source}:${row.source_id}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const favourite = ordered.reduce((best, row) => {
      const plays = counts.get(`${row.source}:${row.source_id}`)
      return !best || plays > best.plays ? { row, plays } : best
    }, null)
    return {
      period: { from: ordered[0].played_at, to: ordered.at(-1).played_at },
      trackCount: ordered.length,
      totalDurationMs: ordered.reduce((sum, row) => sum + row.duration_ms, 0),
      tracks: ordered.slice(0, CARD_TRACK_LIMIT).map((row) => ({ title: row.title, artist: row.artist, album: row.album,
        coverUrl: row.cover_url, playedAt: row.played_at, source: row.source, sourceId: row.source_id })),
      notes: ordered.filter((row) => row.note_content != null).slice(0, CARD_NOTE_LIMIT)
        .map((row) => ({ content: row.note_content, title: row.title, playedAt: row.played_at })),
      highlight: { title: favourite.row.title, artist: favourite.row.artist, plays: favourite.plays },
    }
  }
  function milestone(userId) {
    const totals = database.prepare(`SELECT COUNT(*) AS plays, COALESCE(SUM(duration_ms),0) AS duration_ms,
      COUNT(DISTINCT source || ':' || source_id) AS tracks, COUNT(DISTINCT artist) AS artists,
      MIN(played_at) AS first_at, MAX(played_at) AS last_at FROM playback_events WHERE user_id=?`).get(userId)
    const days = database.prepare(`SELECT date(played_at,?) AS day, COUNT(*) AS plays
      FROM playback_events WHERE user_id=? GROUP BY day ORDER BY day DESC`).all(modifier, userId)
    const hours = database.prepare(`SELECT CAST(strftime('%H',played_at,?) AS INTEGER) AS hour,COUNT(*) AS plays
      FROM playback_events WHERE user_id=? GROUP BY hour`).all(modifier, userId)
    const monthly = database.prepare(`SELECT strftime('%Y-%m',played_at,?) AS month,COUNT(*) AS plays,COALESCE(SUM(duration_ms),0) AS duration_ms
      FROM playback_events WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 12`).all(modifier, userId)
    // 播放次数和排序使用累计值，播放器收到的时长始终是最新记录的单曲时长。
    const top = database.prepare(`WITH track_totals AS (
      SELECT source,source_id,COUNT(*) AS plays,SUM(duration_ms) AS total_duration_ms
      FROM playback_events WHERE user_id=? GROUP BY source,source_id
    ) SELECT e.title,e.artist,e.cover_url,e.source,e.source_id,e.duration_ms,t.plays
      FROM track_totals t JOIN playback_events e ON e.id=(
        SELECT id FROM playback_events WHERE user_id=? AND source=t.source AND source_id=t.source_id
        ORDER BY played_at DESC,id DESC LIMIT 1
      ) ORDER BY t.plays DESC,t.total_duration_ms DESC,e.id DESC LIMIT 5`).all(userId, userId)
    const busiest = days.reduce((best, day) => !best || day.plays > best.plays ? day : best, null)
    const today = new Date(Date.now() + timezoneOffsetMinutes * 60000).toISOString().slice(0, 10)
    return {
      timezoneOffsetMinutes, totalPlays: totals.plays, totalDurationMs: totals.duration_ms,
      distinctTracks: totals.tracks, distinctArtists: totals.artists, firstPlayedAt: totals.first_at, lastPlayedAt: totals.last_at,
      activeDays: days.length, streakDays: computeStreak(days.map((row) => row.day), today),
      busiestDay: busiest ? { date: busiest.day, plays: busiest.plays } : null,
      noteCount: database.prepare('SELECT COUNT(*) AS n FROM footprint_notes WHERE user_id=?').get(userId).n,
      hourly: Array.from({ length: 24 }, (_, hour) => hours.find((row) => row.hour === hour)?.plays || 0),
      monthly: monthly.reverse().map((row) => ({ month: row.month, plays: row.plays, durationMs: row.duration_ms })),
      topTracks: top.map((row) => ({ title: row.title, artist: row.artist, coverUrl: row.cover_url, source: row.source,
        sourceId: row.source_id, trackKey: `${row.source}:${row.source_id}`, plays: row.plays, durationMs: row.duration_ms })),
    }
  }
  return {
    timezoneOffsetMinutes,
    recordPlayback: (userId, payload) => repository.transaction(() => {
      const recent = repository.recentEvent(userId, payload)
      if (recent) return recent.id
      if (repository.countEvents(userId) >= EVENT_LIMIT) throw new FootprintError(409, '播放记录数量已达上限')
      return repository.addEvent(userId, { ...payload, artist: payload.artist || '未知艺术家', album: payload.album || null, coverUrl: sanitizeCoverUrl(payload.coverUrl) })
    }),
    timeline: (userId, limit, offset) => ({ timezoneOffsetMinutes, total: repository.countEvents(userId), events: repository.listEvents(userId, limit, offset).map(toEvent) }),
    milestone,
    saveNote: (userId, eventId, content) => repository.transaction(() => {
      if (!repository.findEvent(userId, eventId)) throw new FootprintError(404, '播放记录不存在')
      repository.saveNote(userId, eventId, content)
    }),
    deleteNote: repository.deleteNote,
    cards: (userId, limit, offset) => ({ total: repository.countCards(userId), cards: repository.listCards(userId, limit, offset).map(toCard) }),
    card: (userId, id) => toCard(repository.findCard(userId, id)),
    createCard: (userId, title, eventIds) => repository.transaction(() => {
      const data = buildCardData(userId, eventIds)
      if (JSON.stringify(data).length > 20000) throw new FootprintError(400, '所选记录内容过大，请减少记录或随笔')
      if (repository.countCards(userId) >= CARD_LIMIT) throw new FootprintError(409, '回忆卡片数量已达上限')
      const id = repository.createCard(userId, title, eventIds, data)
      return toCard(repository.findCard(userId, id))
    }),
    deleteCard: repository.deleteCard,
    posts: (userId, limit, offset) => ({ total: repository.countPosts(), posts: repository.listPosts(userId, limit, offset).map(toPost) }),
    ownPosts: (userId, limit, offset) => repository.ownPosts(userId, limit, offset).map(toPost),
    post: (userId, id) => toPost(requirePost(userId, id)),
    publishCard: (userId, cardId, caption) => repository.transaction(() => {
      if (!repository.findCard(userId, cardId)) throw new FootprintError(404, '卡片不存在')
      if (repository.findPostByCard(cardId)) throw new FootprintError(409, '这张卡片已经分享过了')
      return repository.createPost(userId, cardId, caption)
    }),
    deletePost: repository.deletePost,
    setLiked: (postId, userId, liked) => repository.transaction(() => {
      requirePost(userId, postId)
      return repository.setLiked(postId, userId, liked)
    }),
    comments: (postId, limit = 50, offset = 0, viewerId) => {
      requirePost(null, postId)
      return repository.comments(postId, limit, offset).map((row) => ({ id: row.id, postId: row.post_id,
        authorId: row.user_id, authorNickname: row.author_nickname, content: row.content, createdAt: row.created_at, canDelete: row.user_id === viewerId }))
    },
    addComment: (postId, userId, content) => repository.transaction(() => {
      requirePost(userId, postId)
      if (repository.countComments(postId) >= COMMENT_LIMIT) throw new FootprintError(409, '这条分享的评论已满')
      return repository.addComment(postId, userId, content)
    }),
    deleteComment: repository.deleteComment,
  }
}

module.exports = { createFootprintService, FootprintError, computeStreak, sanitizeCoverUrl,
  CARD_LIMIT, CARD_EVENT_LIMIT, CARD_TRACK_LIMIT, CARD_NOTE_LIMIT, EVENT_LIMIT, COMMENT_LIMIT }
