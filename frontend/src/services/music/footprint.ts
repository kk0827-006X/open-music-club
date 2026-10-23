import type { MusicSource } from '../../shared/music.ts'

export type FootprintEvent = {
  id: number; source: MusicSource; sourceId: string; trackKey: string; title: string; artist: string;
  album: string | null; coverUrl: string | null; durationMs: number; playedAt: string;
  note: { id: number; content: string; updatedAt: string } | null
}
export type FootprintMilestone = {
  totalPlays: number; totalDurationMs: number; distinctTracks: number; distinctArtists: number;
  firstPlayedAt: string | null; lastPlayedAt: string | null; activeDays: number; streakDays: number;
  busiestDay: { date: string; plays: number } | null; noteCount: number; hourly: number[];
  monthly: { month: string; plays: number; durationMs: number }[];
  topTracks: { title: string; artist: string; coverUrl: string | null; source: MusicSource; sourceId: string; trackKey: string; plays: number; durationMs: number }[];
  timezoneOffsetMinutes?: number
}
export type MemoryCard = {
  id: number; title: string; eventIds: number[]; createdAt: string;
  data: { period: { from: string; to: string }; trackCount: number; totalDurationMs: number;
    tracks: { title: string; artist: string; album: string | null; coverUrl: string | null; playedAt: string; source: MusicSource; sourceId: string }[];
    notes: { content: string; title: string; playedAt: string }[];
    highlight: { title: string; artist: string; plays: number } | null }
}
export type FootprintPost = { id: number; cardId: number; authorId: number; authorNickname: string; caption: string; createdAt: string; likeCount: number; commentCount: number; liked: boolean }
export type FootprintComment = { id: number; postId: number; authorId: number; authorNickname: string; content: string; createdAt: string; canDelete?: boolean }
export type FootprintDetail = { post: FootprintPost; card: Pick<MemoryCard, 'id' | 'title' | 'data' | 'createdAt'> | null; comments: FootprintComment[]; canDelete: boolean; viewerId?: number; timezoneOffsetMinutes?: number }
export type FootprintTimeline = { total: number; events: FootprintEvent[]; timezoneOffsetMinutes?: number }
export type FootprintTrackReport = { source: MusicSource; sourceId: string; title: string; artist: string; album?: string | null; durationMs: number; coverUrl?: string | null }
type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export function durationToMs(text: string): number {
  if (!/^\d+(?::[0-5]\d){0,2}$/.test(text)) return 0
  const seconds = text.split(':').reduce((value, part) => value * 60 + Number(part), 0)
  return Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : 0
}
export class FootprintError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export const isFootprintAbort = (error: unknown) => typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
const assertActive = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError') }

export function createFootprintClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  const request = async <T>(url: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> => {
    assertActive(signal)
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token', 'GET', undefined, signal)
      assertActive(signal)
      if (!token.csrfToken) throw new Error('无法建立安全会话，请重新登录')
      headers['X-CSRF-Token'] = token.csrfToken
      if (body) headers['Content-Type'] = 'application/json'
    }
    let response
    try {
      response = await fetcher(url, { method, credentials: 'same-origin', cache: 'no-store', headers, signal,
        ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch (error) {
      assertActive(signal)
      if (isFootprintAbort(error)) throw error
      throw new Error('无法连接服务器，请稍后重试')
    }
    assertActive(signal)
    if (!response.ok) {
      const messages: Record<number, string> = { 400: '提交内容无效，请检查后重试', 401: '登录已失效，请重新登录',
        403: '权限或安全校验失败，请刷新后重试', 404: '内容已不存在，请刷新列表',
        409: '内容已存在或状态发生变化，请刷新列表', 429: '操作过于频繁，请稍后重试' }
      throw new FootprintError(messages[response.status] || '保存或读取失败，请稍后重试', response.status)
    }
    try { const data = await response.json() as T; assertActive(signal); return data }
    catch (error) { assertActive(signal); if (isFootprintAbort(error)) throw error; throw new Error('服务器响应异常，请稍后重试') }
  }
  return {
    report: (track: FootprintTrackReport, signal?: AbortSignal) => request<{ eventId: number }>('/api/footprint/events', 'POST', {
      source: track.source, sourceId: track.sourceId, title: track.title, artist: track.artist,
      album: track.album ?? '', coverUrl: track.coverUrl ?? '',
      durationMs: Number.isFinite(track.durationMs) && track.durationMs > 0 ? Math.round(track.durationMs) : 0,
    }, signal),
    timeline: (limit = 30, offset = 0, signal?: AbortSignal) => request<FootprintTimeline>(`/api/footprint/timeline?limit=${limit}&offset=${offset}`, 'GET', undefined, signal),
    saveNote: (eventId: number, content: string, signal?: AbortSignal) => request(`/api/footprint/events/${eventId}/note`, 'PUT', { content }, signal),
    deleteNote: (eventId: number, signal?: AbortSignal) => request(`/api/footprint/events/${eventId}/note`, 'DELETE', undefined, signal),
    milestone: async (signal?: AbortSignal) => {
      const data = await request<{ milestone: FootprintMilestone; timezoneOffsetMinutes?: number }>('/api/footprint/milestone', 'GET', undefined, signal)
      return { ...data.milestone, timezoneOffsetMinutes: data.timezoneOffsetMinutes ?? data.milestone.timezoneOffsetMinutes }
    },
    cards: (limit = 30, offset = 0, signal?: AbortSignal) => request<{ total: number; cards: MemoryCard[] }>(`/api/footprint/cards?limit=${limit}&offset=${offset}`, 'GET', undefined, signal),
    createCard: async (title: string, eventIds: number[], signal?: AbortSignal) => (await request<{ card: MemoryCard }>('/api/footprint/cards', 'POST', { title, eventIds }, signal)).card,
    deleteCard: (id: number, signal?: AbortSignal) => request(`/api/footprint/cards/${id}`, 'DELETE', undefined, signal),
    posts: (limit = 20, offset = 0, signal?: AbortSignal) => request<{ total: number; posts: FootprintPost[] }>(`/api/footprint/posts?limit=${limit}&offset=${offset}`, 'GET', undefined, signal),
    myPosts: async (limit = 30, offset = 0, signal?: AbortSignal) => (await request<{ posts: FootprintPost[] }>(`/api/footprint/posts/mine?limit=${limit}&offset=${offset}`, 'GET', undefined, signal)).posts,
    publish: async (cardId: number, caption: string, signal?: AbortSignal) => (await request<{ postId: number }>('/api/footprint/posts', 'POST', { cardId, caption }, signal)).postId,
    post: (id: number, signal?: AbortSignal) => request<FootprintDetail>(`/api/footprint/posts/${id}`, 'GET', undefined, signal),
    comments: async (postId: number, limit = 50, offset = 0, signal?: AbortSignal) => (await request<{ comments: FootprintComment[] }>(`/api/footprint/posts/${postId}/comments?limit=${limit}&offset=${offset}`, 'GET', undefined, signal)).comments,
    deletePost: (id: number, signal?: AbortSignal) => request(`/api/footprint/posts/${id}`, 'DELETE', undefined, signal),
    setLiked: async (id: number, liked: boolean, signal?: AbortSignal) => (await request<{ likeCount: number }>(`/api/footprint/posts/${id}/like`, liked ? 'PUT' : 'DELETE', undefined, signal)).likeCount,
    addComment: (postId: number, content: string, signal?: AbortSignal) => request(`/api/footprint/posts/${postId}/comments`, 'POST', { content }, signal),
    deleteComment: (id: number, signal?: AbortSignal) => request(`/api/footprint/comments/${id}`, 'DELETE', undefined, signal),
  }
}
