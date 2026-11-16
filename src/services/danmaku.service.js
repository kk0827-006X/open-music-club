// 弹幕墙业务规则：内容校验、发送限速、时间戳钳制；数据读写都在 db/danmaku。
const repository = require('../db/danmaku')

const CONTENT_MAX = 60
const POSITION_CAP_MS = 60 * 60 * 1000
const SEND_COOLDOWN_MS = 2000
const SOURCES = new Set(['local', 'netease'])

// 同一批热梗弹幕里去掉首尾空白与控制字符；不在此做敏感词表，屏蔽词由每个用户在前端自选。
function cleanContent(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max)
}

class DanmakuError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function createDanmakuService({ database, now = () => Date.now() } = {}) {
  // created_at 是 SQLite 的 UTC "YYYY-MM-DD HH:MM:SS"，统一转毫秒再比较。
  function toMillis(stamp) {
    if (!stamp) return 0
    const parsed = Date.parse(`${String(stamp).replace(' ', 'T')}Z`)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  function normalizeTrack(track) {
    const source = track?.source
    const sourceId = cleanText(track?.sourceId, 64)
    if (!SOURCES.has(source) || !sourceId) {
      throw new DanmakuError('歌曲标识无效，请重新选择歌曲', 400)
    }
    const title = cleanText(track?.title, 120)
    if (!title) throw new DanmakuError('缺少歌曲标题，请重新选择歌曲', 400)
    return {
      trackSource: source,
      trackSourceId: sourceId,
      trackTitle: title,
      trackArtist: cleanText(track?.artist, 120),
    }
  }

  function normalizeContent(content) {
    const text = cleanContent(content)
    if (!text) throw new DanmakuError('弹幕内容不能为空', 400)
    if (text.length > CONTENT_MAX) {
      throw new DanmakuError(`弹幕最长 ${CONTENT_MAX} 个字符`, 400)
    }
    return text
  }

  function normalizePosition(positionMs, durationMs) {
    const value = Number(positionMs)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DanmakuError('弹幕进度无效，请回到歌曲进度条上再发送', 400)
    }
    const cap = Number.isSafeInteger(durationMs) && durationMs > 0
      ? Math.min(durationMs, POSITION_CAP_MS)
      : POSITION_CAP_MS
    return Math.min(value, cap)
  }

  async function send({ userId, nickname, track, content, positionMs, durationMs }) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new DanmakuError('请先登录再发弹幕', 401)
    }
    const who = cleanText(nickname, 40) || '神秘听众'
    const text = normalizeContent(content)
    const position = normalizePosition(positionMs, durationMs)
    const target = normalizeTrack(track)

    const latest = repository.latestUserMessage(database, userId)
    if (latest && now() - toMillis(latest.created_at) < SEND_COOLDOWN_MS) {
      throw new DanmakuError('发送太快啦，休息两秒再来一条', 429)
    }

    const id = repository.insertMessage(database, {
      ...target,
      userId,
      nickname: who,
      content: text,
      positionMs: position,
    })
    return {
      id,
      ...target,
      userId,
      nickname: who,
      content: text,
      positionMs: position,
      createdAt: new Date(now()).toISOString(),
      mine: true,
    }
  }

  function list({ source, sourceId, afterId = 0, limit } = {}) {
    const target = normalizeTrack({ source, sourceId, title: 'probe' })
    const size = limit === undefined ? repository.PAGE_LIMIT : Number(limit)
    if (!Number.isSafeInteger(size) || size < 1 || size > repository.PAGE_LIMIT) {
      throw new DanmakuError('弹幕数量参数无效', 400)
    }
    const after = Number(afterId) || 0
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new DanmakuError('弹幕增量参数无效', 400)
    }
    const rows = repository.listTrackMessages(database, {
      source: target.trackSource,
      sourceId: target.trackSourceId,
      afterId: after,
      limit: size,
    })
    return {
      total: repository.countTrackMessages(database, {
        source: target.trackSource,
        sourceId: target.trackSourceId,
      }),
      messages: rows.map((row) => ({
        id: row.id,
        source: row.track_source,
        sourceId: row.track_source_id,
        userId: row.user_id,
        nickname: row.nickname,
        content: row.content,
        positionMs: row.position_ms,
        createdAt: row.created_at,
      })),
    }
  }

  // 全站实时弹幕流：跨歌曲的最新弹幕，弹幕墙不播放歌曲时也有内容可看。
  function recent({ afterId = 0, limit } = {}) {
    const size = limit === undefined ? repository.RECENT_LIMIT : Number(limit)
    if (!Number.isSafeInteger(size) || size < 1 || size > repository.RECENT_LIMIT) {
      throw new DanmakuError('弹幕数量参数无效', 400)
    }
    const after = Number(afterId) || 0
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new DanmakuError('弹幕增量参数无效', 400)
    }
    const rows = repository.listRecentMessages(database, { afterId: after, limit: size })
    return {
      total: repository.countTotalMessages(database),
      messages: rows.map((row) => ({
        id: row.id,
        source: row.track_source,
        sourceId: row.track_source_id,
        trackTitle: row.track_title,
        trackArtist: row.track_artist,
        userId: row.user_id,
        nickname: row.nickname,
        content: row.content,
        positionMs: row.position_ms,
        createdAt: row.created_at,
      })),
    }
  }

  function remove({ userId, id } = {}) {
    const messageId = Number(id)
    if (!Number.isSafeInteger(messageId) || messageId < 1) {
      throw new DanmakuError('弹幕 ID 无效', 400)
    }
    if (!repository.deleteOwnMessage(database, { id: messageId, userId })) {
      // 只能删自己的：别人的弹幕对他而言等于不存在，返回 404 避免探测他人数据。
      const existed = repository.findMessage(database, messageId)
      throw new DanmakuError(existed ? '只能删除自己发送的弹幕' : '这条弹幕已经不在了', existed ? 403 : 404)
    }
    return { removed: true }
  }

  return { send, list, recent, remove }
}

module.exports = {
  CONTENT_MAX,
  DanmakuError,
  SEND_COOLDOWN_MS,
  createDanmakuService,
}
