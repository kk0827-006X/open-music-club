// 弹幕业务规则：内容校验、发送限速、时间戳钳制、语音/图片媒体校验；数据读写都在 db/danmaku。
const repository = require('../db/danmaku')

const CONTENT_MAX = 60
const POSITION_CAP_MS = 60 * 60 * 1000
const SEND_COOLDOWN_MS = 2000
const SOURCES = new Set(['local', 'netease'])
// 文字 / 语音 / 图片三种弹幕；语音和图片必须带上传完成后的媒体文件名。
const KINDS = new Set(['text', 'voice', 'image'])
const MEDIA_KINDS = new Set(['voice', 'image'])
const VOICE_MAX_MS = 60 * 1000
// 只接受媒体上传接口生成的 UUID 文件名，杜绝路径穿越和任意文件读取。
const MEDIA_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webm|mp3|ogg|m4a|wav|jpg|jpeg|png|webp|gif)$/i
const MEDIA_URL_PREFIX = '/api/me/danmaku/media/'
const PLACEHOLDER = { voice: '语音弹幕', image: '图片弹幕' }

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

function mediaUrlOf(path) {
  return path ? `${MEDIA_URL_PREFIX}${path}` : null
}

// 数据库行 → 接口消息；语音/图片弹幕带上可直接用于 <img>/<audio> 的地址。
function toMessage(row) {
  return {
    id: row.id,
    source: row.track_source,
    sourceId: row.track_source_id,
    userId: row.user_id,
    nickname: row.nickname,
    content: row.content,
    kind: row.kind || 'text',
    mediaUrl: mediaUrlOf(row.media_path),
    mediaDurationMs: row.media_duration_ms ?? 0,
    positionMs: row.position_ms,
    createdAt: row.created_at,
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

  function normalizeKind(value) {
    const kind = value === undefined || value === null || value === '' ? 'text' : String(value)
    if (!KINDS.has(kind)) throw new DanmakuError('弹幕类型无效', 400)
    return kind
  }

  function normalizeContent(content, kind) {
    const text = cleanContent(content)
    // 语音/图片弹幕的文字是可选的附言；为空时用类型占位，满足表上的非空约束。
    if (!text) {
      if (MEDIA_KINDS.has(kind)) return PLACEHOLDER[kind]
      throw new DanmakuError('弹幕内容不能为空', 400)
    }
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

  function normalizeMedia({ kind, mediaPath, mediaDurationMs }) {
    if (!MEDIA_KINDS.has(kind)) return { mediaPath: null, mediaDurationMs: null }
    const path = cleanText(mediaPath, 120)
    if (!path || !MEDIA_FILE.test(path)) {
      throw new DanmakuError('语音或图片还没上传完成，请重新发送', 400)
    }
    if (kind === 'image') return { mediaPath: path, mediaDurationMs: null }
    const duration = Number(mediaDurationMs)
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > VOICE_MAX_MS) {
      throw new DanmakuError('语音时长需在 60 秒以内', 400)
    }
    return { mediaPath: path, mediaDurationMs: duration }
  }

  async function send({ userId, nickname, track, content, positionMs, durationMs, kind, mediaPath, mediaDurationMs }) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new DanmakuError('请先登录再发弹幕', 401)
    }
    const who = cleanText(nickname, 40) || '神秘听众'
    const messageKind = normalizeKind(kind)
    const text = normalizeContent(content, messageKind)
    const position = normalizePosition(positionMs, durationMs)
    const media = normalizeMedia({ kind: messageKind, mediaPath, mediaDurationMs })
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
      kind: messageKind,
      ...media,
      positionMs: position,
    })
    return {
      id,
      ...target,
      userId,
      nickname: who,
      content: text,
      kind: messageKind,
      mediaUrl: mediaUrlOf(media.mediaPath),
      mediaDurationMs: media.mediaDurationMs ?? 0,
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
      messages: rows.map(toMessage),
    }
  }

  // 全站实时弹幕流：跨歌曲的最新弹幕，不播放歌曲时也有内容可看。
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
        ...toMessage(row),
        trackTitle: row.track_title,
        trackArtist: row.track_artist,
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
  KINDS,
  MEDIA_FILE,
  MEDIA_URL_PREFIX,
  SEND_COOLDOWN_MS,
  VOICE_MAX_MS,
  createDanmakuService,
}
