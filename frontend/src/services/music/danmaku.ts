// 弹幕接口适配：Session、CSRF 与错误脱敏规则与音乐盲盒保持一致。
export type DanmakuTrackRef = {
  source: 'local' | 'netease'
  sourceId: string
  title: string
  artist?: string
  durationMs?: number
}

// 三种弹幕：文字 / 语音 / 图片；语音和图片先上传媒体再发送。
export type DanmakuKind = 'text' | 'voice' | 'image'

export type DanmakuMessage = {
  id: number
  source: string
  sourceId: string
  userId: number
  nickname: string
  content: string
  kind: DanmakuKind
  mediaUrl: string | null
  mediaDurationMs: number
  positionMs: number
  createdAt: string
}

export type DanmakuSent = DanmakuMessage & { mine: true }

export type DanmakuSendExtras = {
  kind?: DanmakuKind
  mediaPath?: string
  mediaDurationMs?: number
}

export type DanmakuMediaUpload = { path: string; kind: 'voice' | 'image'; durationMs: number; url: string }

// 从播放条目 key（local:7 / netease:song:11）还原接口需要的歌曲标识。
export function trackRefOf(track: { key: string; title: string; artist: string; duration: string } | null): DanmakuTrackRef | null {
  if (!track) return null
  const index = track.key.indexOf(':')
  if (index <= 0) return null
  const rawSource = track.key.slice(0, index)
  const source: 'local' | 'netease' | null = rawSource === 'local' ? 'local' : rawSource === 'netease' ? 'netease' : null
  if (!source) return null
  const sourceId = track.key.slice(index + 1)
  if (!sourceId) return null
  const parts = track.duration.split(':').map((part) => Number.parseInt(part, 10))
  const durationMs = parts.every((part) => Number.isFinite(part)) && parts.length >= 2
    ? (parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    : 0
  return { source, sourceId, title: track.title, artist: track.artist, durationMs }
}

// 全站实时流里的弹幕带歌曲信息，弹幕墙侧栏按「歌曲 · 进度」标注来源。
export type DanmakuRecentMessage = DanmakuMessage & { trackTitle: string; trackArtist: string }

type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

const ERRORS: Record<number, string> = {
  400: '弹幕内容或进度无效，请检查后重试',
  401: '登录已失效，请重新登录',
  403: '权限或安全校验失败，请刷新后重试',
  404: '这条弹幕已经不在了',
  413: '媒体文件过大，语音请控制在 60 秒内',
  429: '发送太快啦，休息两秒再来一条',
}

export class DanmakuError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export function createDanmakuClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  const request = async <T>(url: string, method = 'GET', body?: object): Promise<T> => {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token')
      if (!token.csrfToken) throw new DanmakuError('无法建立安全会话，请重新登录', 403)
      headers['X-CSRF-Token'] = token.csrfToken
    }
    if (body) headers['Content-Type'] = 'application/json'
    let response
    try {
      response = await fetcher(url, {
        method, credentials: 'same-origin', cache: 'no-store', headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw new DanmakuError('无法连接服务器，请稍后重试', 0) }
    if (!response.ok) throw new DanmakuError(ERRORS[response.status] || '操作失败，请稍后重试', response.status)
    try { return await response.json() as T } catch { throw new DanmakuError('服务器响应异常，请稍后重试', 0) }
  }

  return {
    list: async (source: string, sourceId: string, afterId = 0, limit = 500) =>
      request<{ messages: DanmakuMessage[]; total: number }>(
        `/api/me/danmaku?source=${encodeURIComponent(source)}&sourceId=${encodeURIComponent(sourceId)}&afterId=${afterId}&limit=${limit}`,
      ),
    recent: async (afterId = 0, limit = 30) =>
      request<{ messages: DanmakuRecentMessage[]; total: number }>(
        `/api/me/danmaku/recent?afterId=${afterId}&limit=${limit}`,
      ),
    send: async (track: DanmakuTrackRef, content: string, positionMs: number, extras: DanmakuSendExtras = {}) => (await request<{ message: DanmakuSent }>(
      '/api/me/danmaku', 'POST',
      {
        track: { source: track.source, sourceId: track.sourceId, title: track.title, artist: track.artist ?? '' },
        content, positionMs, durationMs: track.durationMs ?? 0,
        ...extras,
      },
    )).message,
    // 语音/图片弹幕先上传媒体文件，再把返回的 path 带进 send。
    uploadMedia: async (file: Blob, kind: 'voice' | 'image', filename: string, durationMs = 0) => {
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token')
      if (!token.csrfToken) throw new DanmakuError('无法建立安全会话，请重新登录', 403)
      const form = new FormData()
      form.append('file', file, filename)
      form.append('durationMs', String(Math.max(0, Math.round(durationMs))))
      form.append('kind', kind)
      let response
      try {
        response = await fetcher('/api/me/danmaku/media', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'X-CSRF-Token': token.csrfToken }, body: form,
        })
      } catch { throw new DanmakuError('无法连接服务器，请稍后重试', 0) }
      if (!response.ok) throw new DanmakuError(ERRORS[response.status] || '媒体上传失败，请稍后重试', response.status)
      const payload = await response.json() as { media?: DanmakuMediaUpload }
      if (!payload.media?.path) throw new DanmakuError('服务器响应异常，请稍后重试', 0)
      return payload.media
    },
    remove: async (id: number) => (await request<{ removed: boolean }>(`/api/me/danmaku/${id}`, 'DELETE')).removed,
  }
}

export type DanmakuClient = ReturnType<typeof createDanmakuClient>

export function formatPosition(positionMs: number): string {
  const total = Math.max(0, Math.floor(positionMs / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// 屏蔽词由用户自选：逗号/换行分隔，忽略大小写；空词不参与匹配。
export function parseBlocklist(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
}

export function matchesBlocklist(content: string, blocklist: readonly string[]): boolean {
  if (!blocklist.length) return false
  const text = content.toLowerCase()
  return blocklist.some((word) => text.includes(word))
}

// 时间戳触发的核心规则：上次检查点(lastMs, 排除) 到当前进度(currentMs, 包含] 之间的弹幕准时飘出；
// 快进/拖动进度条（间隔超过 5 秒）时静默跳过，避免旧弹幕刷屏。
export function dueMessages<T extends { positionMs: number }>(
  messages: readonly T[], lastMs: number, currentMs: number,
): T[] {
  if (!Number.isFinite(currentMs) || currentMs < 0) return []
  if (currentMs - lastMs > 5000) return []
  return messages.filter((message) => message.positionMs > lastMs && message.positionMs <= currentMs)
}

// 页面本地弹幕设置（开关、透明度、屏蔽词），持久化在 localStorage。
export type DanmakuSettings = { enabled: boolean; opacity: number; blocklist: string }
const SETTINGS_KEY = 'open-music-club.danmaku.settings'

export function loadSettings(storage: Pick<Storage, 'getItem'> = globalThis.localStorage): DanmakuSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY)
    if (!raw) return { enabled: true, opacity: 0.9, blocklist: '' }
    const parsed = JSON.parse(raw) as Partial<DanmakuSettings>
    const opacity = Number(parsed.opacity)
    return {
      enabled: parsed.enabled !== false,
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.2, opacity)) : 0.9,
      blocklist: typeof parsed.blocklist === 'string' ? parsed.blocklist.slice(0, 500) : '',
    }
  } catch {
    return { enabled: true, opacity: 0.9, blocklist: '' }
  }
}

export function saveSettings(settings: DanmakuSettings, storage: Pick<Storage, 'setItem'> = globalThis.localStorage): void {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* 隐私模式下静默跳过 */ }
}
