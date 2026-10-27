// 音乐盲盒业务规则：风格标签映射、随机抽样、抽取记录、收藏与榜单。
// 曲库由「本地音乐（genre 元数据打标）」与「网易云风格标签缓存」组成，两者保持独立来源。
const repository = require('../db/blindBox')

const CACHE_TTL = 24 * 60 * 60 * 1000
const RETRY_COOLDOWN = 5 * 60 * 1000
const POOL_TARGET = 30
const MAX_BOX_SIZE = 5

// 风格标签是全站唯一配置：label 展示，keywords 用于网易云候选检索，genres 用于本地音乐元数据匹配。
const STYLES = [
  { key: 'pop', label: '流行', keywords: ['华语流行', '流行'], genres: ['pop', '流行', 'mandopop', 'cantopop', 'j-pop', 'k-pop', 'city pop'] },
  { key: 'jazz', label: '爵士', keywords: ['爵士'], genres: ['jazz', '爵士', 'bossa nova', 'swing', 'smooth jazz'] },
  { key: 'rock', label: '摇滚', keywords: ['摇滚'], genres: ['rock', '摇滚', 'punk', '朋克', 'metal', '金属', 'grunge', 'indie'] },
  { key: 'electronic', label: '电子', keywords: ['电子'], genres: ['electronic', 'electronica', 'edm', 'house', 'techno', 'trance', 'synth', '电子', '电音'] },
  { key: 'folk', label: '民谣', keywords: ['民谣'], genres: ['folk', '民谣', 'acoustic', 'country', 'singer-songwriter'] },
  { key: 'classical', label: '古典', keywords: ['古典'], genres: ['classical', '古典', 'baroque', 'opera', 'symphony', 'orchestra', 'chamber'] },
  { key: 'hiphop', label: '说唱', keywords: ['说唱'], genres: ['hip hop', 'hip-hop', 'hiphop', 'rap', '说唱', 'trap', '嘻哈'] },
  { key: 'rnb', label: 'R&B', keywords: ['R&B'], genres: ['r&b', 'rnb', 'soul', 'neo soul', '节奏布鲁斯'] },
  { key: 'other', label: '综合', keywords: [], genres: [] },
]
const FALLBACK_STYLE = STYLES[STYLES.length - 1]
const STYLE_BY_KEY = new Map([['all', { key: 'all', label: '全部', keywords: [], genres: [] }], ...STYLES.map((style) => [style.key, style])])

class BlindBoxError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function normalizeGenre(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}

// 一个音频可能带多个风格（"Jazz; Vocal"），按首次命中的标签归档，未知风格进入「综合」。
function styleOfGenre(genre) {
  const text = normalizeGenre(genre)
  if (!text) return FALLBACK_STYLE
  for (const style of STYLES) {
    if (style.genres.some((token) => text.includes(token))) return style
  }
  return FALLBACK_STYLE
}

function styleOfKey(key) {
  return STYLE_BY_KEY.get(typeof key === 'string' ? key.trim() : '') || null
}

function safeCover(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) return null
    url.protocol = 'https:'
    return url.href
  } catch {
    return null
  }
}

function localItem(row) {
  return {
    source: 'local',
    sourceId: String(row.id),
    style: styleOfGenre(row.genre).key,
    title: row.title,
    artist: row.artist,
    album: row.album,
    coverUrl: row.cover_path ? `/api/local/music/${row.id}/cover` : null,
    durationMs: row.duration_ms,
  }
}

function neteaseItem(song, style) {
  if (!song || !Number.isSafeInteger(song.id) || typeof song.name !== 'string') return null
  const artists = Array.isArray(song.ar)
    ? song.ar.map((artist) => (typeof artist?.name === 'string' ? artist.name.trim() : '')).filter(Boolean)
    : []
  return {
    source: 'netease',
    sourceId: String(song.id),
    style,
    title: song.name,
    artist: artists.join('、') || '未知艺术家',
    album: typeof song.al?.name === 'string' ? song.al.name : null,
    coverUrl: safeCover(song.al?.picUrl),
    durationMs: Number.isSafeInteger(song.dt) ? song.dt : 0,
  }
}

const trackKey = (track) => `${track.source}:${track.sourceId}`
// 对外 key 与搜索页保持一致：网易云用 netease:song:<id>，本地用 local:<id>，队列去重才能命中同一首。
const publicKey = (track) => track.source === 'netease' ? `netease:song:${track.sourceId}` : `local:${track.sourceId}`

function randomIndex(random, size) {
  const value = Number(random())
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0
  return Math.floor(normalized * size)
}

// 部分 Fisher–Yates：只洗前 count 个位置，避免整库排序。上一箱抽过的歌在曲库足够时避开。
function sampleTracks(pool, count, random, exclude) {
  const candidates = exclude.size > 0 && pool.length >= count * 2
    ? pool.filter((track) => !exclude.has(trackKey(track)))
    : pool.slice()
  const list = candidates.slice()
  const size = Math.min(count, list.length)
  for (let index = 0; index < size; index += 1) {
    const swap = index + randomIndex(random, list.length - index)
    const current = list[index]
    list[index] = list[swap]
    list[swap] = current
  }
  return list.slice(0, size)
}

function readCount(value) {
  if (value === undefined || value === null) return 3
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BOX_SIZE) {
    throw new BlindBoxError(`抽取数量需在 1-${MAX_BOX_SIZE} 之间`)
  }
  return count
}

function toTrackPayload(track) {
  const style = styleOfKey(track.style) || FALLBACK_STYLE
  const seconds = Math.max(0, Math.floor((track.durationMs || 0) / 1000))
  return {
    key: publicKey(track),
    source: track.source,
    sourceId: track.sourceId,
    title: track.title,
    artist: track.artist,
    album: track.album || '未归档',
    coverUrl: track.coverUrl || null,
    durationMs: track.durationMs || 0,
    duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    style: style.key,
    styleLabel: style.label,
  }
}

// 抽取记录按列名存库，读取时统一转成内部字段名，避免 key 或时长取到 undefined。
function fromDrawRow(row) {
  return {
    source: row.source,
    sourceId: row.source_id,
    style: row.style,
    title: row.title,
    artist: row.artist,
    album: row.album,
    coverUrl: row.cover_url,
    durationMs: row.duration_ms,
  }
}

function toBox(draw, items, favorited) {
  const style = styleOfKey(draw.style) || FALLBACK_STYLE
  return {
    id: draw.id,
    style: style.key,
    styleLabel: style.label,
    trackCount: draw.track_count,
    createdAt: draw.created_at,
    favorited,
    tracks: items.map((item) => toTrackPayload(fromDrawRow(item))),
  }
}

function createBlindBoxService({ database, neteaseService, random = Math.random, now = Date.now }) {
  const attempts = new Map()

  function loadPool(styleKey) {
    const locals = repository.listLocalTracks(database).map(localItem)
    const cached = repository.listCachedTracks(database, styleKey)
      .map((row) => ({
        source: row.source,
        sourceId: row.source_id,
        style: row.style,
        title: row.title,
        artist: row.artist,
        album: row.album,
        coverUrl: row.cover_url,
        durationMs: row.duration_ms,
      }))
    if (styleKey === 'all') return [...locals, ...cached]
    return [...locals.filter((track) => track.style === styleKey), ...cached]
  }

  // 风格池不足时用风格关键词补充网易云候选；上游失败只影响候选数量，不阻断本地抽取。
  async function ensurePool(style) {
    if (!style.keywords.length || typeof neteaseService?.call !== 'function') return 0
    const cached = repository.countCachedStyle(database, style.key)
    if (cached >= POOL_TARGET) return cached
    const fresh = now() - repository.latestCachedAt(database, style.key) < CACHE_TTL
    const attempted = now() - (attempts.get(style.key) || 0) < RETRY_COOLDOWN
    if (attempted || (fresh && cached > 0)) return cached
    attempts.set(style.key, now())

    const collected = []
    for (const keyword of style.keywords) {
      let body
      try {
        body = await neteaseService.call('search', { keywords: keyword, type: 1, limit: 30 })
      } catch {
        break
      }
      if (body?.code !== 200 || !Array.isArray(body?.result?.songs)) continue
      for (const song of body.result.songs) {
        const item = neteaseItem(song, style.key)
        if (item) collected.push({ ...item, tagSource: 'keyword' })
      }
      if (collected.length >= POOL_TARGET) break
    }
    if (collected.length) repository.saveCachedTracks(database, collected)
    return repository.countCachedStyle(database, style.key)
  }

  function styles() {
    const locals = repository.listLocalTracks(database).map(localItem)
    const counts = new Map(STYLES.map((style) => [style.key, 0]))
    const cached = new Map()
    let total = locals.length
    for (const style of STYLES) {
      const count = style.key === 'other' ? 0 : repository.countCachedStyle(database, style.key)
      cached.set(style.key, count)
      total += count
    }
    for (const track of locals) counts.set(track.style, counts.get(track.style) + 1)
    for (const style of STYLES) {
      if (style.key !== 'other') counts.set(style.key, counts.get(style.key) + cached.get(style.key))
    }
    return {
      total,
      styles: [
        { key: 'all', label: '全部', count: total },
        ...STYLES.map((style) => ({ key: style.key, label: style.label, count: counts.get(style.key) })),
      ],
    }
  }

  async function draw({ userId, style: styleKey, count }) {
    const style = styleOfKey(styleKey === undefined ? 'pop' : styleKey)
    if (!style) throw new BlindBoxError('风格标签无效')
    const size = readCount(count)
    await ensurePool(style)
    const pool = loadPool(style.key)
    if (pool.length === 0) throw new BlindBoxError('曲库里还没有可以抽取的歌曲', 409)
    const tracks = sampleTracks(pool, size, random, new Set(repository.lastDrawKeys(database, userId)))
    const drawId = repository.recordDraw(database, { userId, style: style.key, tracks })
    const saved = repository.findDraw(database, userId, drawId)
    return toBox(saved, repository.listDrawItems(database, drawId), false)
  }

  function box(userId, drawId) {
    const saved = repository.findDraw(database, userId, drawId)
    if (!saved) throw new BlindBoxError('盲盒不存在', 404)
    return toBox(saved, repository.listDrawItems(database, drawId), repository.isFavorited(database, userId, drawId))
  }

  function favorite(userId, drawId) {
    const saved = repository.findDraw(database, userId, drawId)
    if (!saved) throw new BlindBoxError('盲盒不存在', 404)
    repository.addFavorite(database, userId, drawId)
    return box(userId, drawId)
  }

  function unfavorite(userId, drawId) {
    const saved = repository.findDraw(database, userId, drawId)
    if (!saved) throw new BlindBoxError('盲盒不存在', 404)
    repository.removeFavorite(database, userId, drawId)
    return box(userId, drawId)
  }

  function favorites(userId, { limit = 12, offset = 0 } = {}) {
    const rows = repository.listFavoriteBoxes(database, userId, limit, offset)
    const boxes = rows.map((row) => {
      const items = repository.listDrawItems(database, row.id)
      const style = styleOfKey(row.style) || FALLBACK_STYLE
      return {
        id: row.id,
        style: style.key,
        styleLabel: style.label,
        trackCount: row.track_count,
        createdAt: row.created_at,
        favoritedAt: row.favorited_at,
        covers: items.map((item) => item.cover_url).filter(Boolean).slice(0, 4),
        titles: items.slice(0, 3).map((item) => item.title),
      }
    })
    return { boxes, total: repository.countFavorites(database, userId) }
  }

  function ranking({ metric = 'favorite', style = 'all', limit = 8 } = {}) {
    if (!['favorite', 'draw'].includes(metric)) throw new BlindBoxError('榜单类型无效')
    const resolved = styleOfKey(style)
    if (!resolved) throw new BlindBoxError('风格标签无效')
    const size = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 8, 1), 20)
    const rows = repository.listRanking(database, { style: resolved.key, metric, limit: size })
    return {
      metric,
      style: resolved.key,
      styleLabel: resolved.label,
      entries: rows.map((row, index) => {
        const trackStyle = styleOfKey(row.style) || FALLBACK_STYLE
        return {
          rank: index + 1,
          key: publicKey({ source: row.source, sourceId: row.source_id }),
          source: row.source,
          sourceId: row.source_id,
          title: row.title,
          artist: row.artist,
          coverUrl: row.cover_url || null,
          style: trackStyle.key,
          styleLabel: trackStyle.label,
          drawCount: row.draw_count,
          favoriteCount: row.favorite_count,
        }
      }),
    }
  }

  return { box, draw, favorite, favorites, ranking, styles, unfavorite }
}

module.exports = {
  BlindBoxError,
  STYLES,
  createBlindBoxService,
  sampleTracks,
  styleOfGenre,
}