import { safeCoverUrl, type SearchItem } from '../../shared/music.ts'

// 音乐盲盒接口适配：Session、CSRF 与错误脱敏规则与个人音乐库保持一致。
export type BlindBoxStyle = { key: string; label: string; count: number }
export type BlindBoxTrack = {
  key: string; source: 'local' | 'netease'; sourceId: string
  title: string; artist: string; album: string; coverUrl: string | null
  durationMs: number; duration: string; style: string; styleLabel: string
}
export type BlindBox = {
  id: number; style: string; styleLabel: string; trackCount: number
  createdAt: string; favorited: boolean; tracks: BlindBoxTrack[]
}
export type BlindBoxSummary = {
  id: number; style: string; styleLabel: string; trackCount: number
  createdAt: string; favoritedAt: string; covers: string[]; titles: string[]
}
export type RankingEntry = {
  rank: number; key: string; source: 'local' | 'netease'; sourceId: string
  title: string; artist: string; coverUrl: string | null
  style: string; styleLabel: string; drawCount: number; favoriteCount: number
}
export type RankingMetric = 'favorite' | 'draw'
type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

const ERRORS: Record<number, string> = {
  400: '提交内容无效，请检查后重试', 401: '登录已失效，请重新登录',
  403: '权限或安全校验失败，请刷新后重试', 404: '这个盲盒已经不在了',
  409: '曲库里还没有可以抽取的歌曲', 429: '操作过于频繁，请稍后重试',
  502: '音乐服务暂时不可用，请稍后重试',
}

export class BlindBoxError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

// 盲盒曲目与搜索页共用播放模型：kind 固定 song，封面仍走白名单校验。
export function toBlindBoxSong(track: BlindBoxTrack): SearchItem {
  const seconds = Math.floor((track.durationMs || 0) / 1000)
  return {
    key: track.key, kind: 'song', source: track.source, sourceId: track.sourceId,
    title: track.title, artist: track.artist || '未知艺术家', album: track.album || '未归档',
    coverUrl: safeCoverUrl(track.coverUrl), duration: track.duration || `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    year: '—', description: `${track.styleLabel}盲盒曲目`,
  }
}

export function createBlindBoxClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  const request = async <T>(url: string, method = 'GET', body?: object): Promise<T> => {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token')
      if (!token.csrfToken) throw new BlindBoxError('无法建立安全会话，请重新登录', 403)
      headers['X-CSRF-Token'] = token.csrfToken
    }
    if (body) headers['Content-Type'] = 'application/json'
    let response
    try {
      response = await fetcher(url, {
        method, credentials: 'same-origin', cache: 'no-store', headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw new BlindBoxError('无法连接服务器，请稍后重试', 0) }
    if (!response.ok) throw new BlindBoxError(ERRORS[response.status] || '操作失败，请稍后重试', response.status)
    try { return await response.json() as T } catch { throw new BlindBoxError('服务器响应异常，请稍后重试', 0) }
  }

  return {
    styles: async () => request<{ styles: BlindBoxStyle[]; total: number }>('/api/me/blind-box/styles'),
    draw: async (style: string, count: number) => (await request<{ box: BlindBox }>('/api/me/blind-box/draw', 'POST', { style, count })).box,
    box: async (id: number) => (await request<{ box: BlindBox }>(`/api/me/blind-box/boxes/${id}`)).box,
    favorite: async (id: number) => (await request<{ box: BlindBox }>(`/api/me/blind-box/boxes/${id}/favorite`, 'POST')).box,
    unfavorite: async (id: number) => (await request<{ box: BlindBox }>(`/api/me/blind-box/boxes/${id}/favorite`, 'DELETE')).box,
    favorites: async (limit = 12) => request<{ boxes: BlindBoxSummary[]; total: number }>(`/api/me/blind-box/boxes?limit=${limit}`),
    ranking: async (metric: RankingMetric, style = 'all', limit = 8) =>
      request<{ entries: RankingEntry[]; styleLabel: string; metric: RankingMetric }>(`/api/me/blind-box/ranking?metric=${metric}&style=${encodeURIComponent(style)}&limit=${limit}`),
  }
}

export type BlindBoxClient = ReturnType<typeof createBlindBoxClient>
