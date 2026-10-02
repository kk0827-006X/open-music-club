import { safeCoverUrl, type SearchItem } from './music-search.ts'

export type TrackReference = { source: 'local' | 'netease'; sourceId: string }
export type PersonalTrack = TrackReference & { trackKey: string; title: string; artists: { name: string }[];
  album: { name: string | null }; durationMs: number; coverUrl: string | null; playable: boolean; liked?: boolean; entryId?: number }
export type UserPlaylist = { id: number; name: string; description: string | null; trackCount: number; createdAt: string; updatedAt: string }
export type UserProfile = { id: number; nickname: string; avatarUrl: string | null }
type Fetcher = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export class PersonalLibraryError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export function toPersonalSong(track: PersonalTrack): SearchItem {
  const seconds = Math.floor(track.durationMs / 1000)
  return { key: `${track.source}:${track.sourceId}`, kind: 'song', source: track.source, sourceId: track.sourceId,
    title: track.title, artist: track.artists.map((artist) => artist.name).join('、') || '未知艺术家',
    album: track.album.name || '未归档', coverUrl: safeCoverUrl(track.coverUrl),
    duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, year: '—', description: '' }
}

export function createPersonalLibraryClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  const request = async <T>(url: string, method = 'GET', body?: object | FormData): Promise<T> => {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      // 每次写操作获取当前 Session 的令牌，登录重建会话后不复用旧令牌。
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token')
      if (!token.csrfToken) throw new Error('无法建立安全会话，请重新登录')
      headers['X-CSRF-Token'] = token.csrfToken
    }
    const multipart = body instanceof FormData
    if (body && !multipart) headers['Content-Type'] = 'application/json'
    let response
    try {
      response = await fetcher(url, { method, credentials: 'same-origin', cache: 'no-store', headers,
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) })
    } catch { throw new Error('无法连接服务器，请稍后重试') }
    if (!response.ok) {
      const messages: Record<number, string> = { 400: '提交内容无效，请检查后重试', 401: '登录已失效，请重新登录',
        403: '权限或安全校验失败，请刷新后重试', 404: '内容已不存在，请刷新列表',
        409: '内容已存在或状态发生变化，请刷新列表', 413: '图片不能超过 5 MB',
        429: '操作过于频繁，请稍后重试', 502: '音乐服务暂时不可用，请稍后重试' }
      throw new PersonalLibraryError(messages[response.status] || '保存或读取失败，请稍后重试', response.status)
    }
    try { return await response.json() as T } catch { throw new Error('服务器响应异常，请稍后重试') }
  }
  return {
    profile: async () => (await request<{ profile: UserProfile }>('/api/me/profile')).profile,
    uploadAvatar: async (file: File) => {
      const data = new FormData()
      data.append('file', file)
      return (await request<{ profile: UserProfile }>('/api/me/avatar', 'PUT', data)).profile
    },
    playlists: async () => {
      const all: UserPlaylist[] = []
      for (let offset = 0; offset < 100; offset += 50) {
        const page = (await request<{ playlists: UserPlaylist[] }>(`/api/me/playlists?limit=50&offset=${offset}`)).playlists
        all.push(...page)
        if (page.length < 50) break
      }
      return all
    },
    playlist: (id: number) => request<{ playlist: UserPlaylist; tracks: PersonalTrack[] }>(`/api/me/playlists/${id}`),
    createPlaylist: async (name: string) => (await request<{ playlist: UserPlaylist }>('/api/me/playlists', 'POST', { name })).playlist,
    renamePlaylist: (id: number, name: string) => request(`/api/me/playlists/${id}`, 'PATCH', { name }),
    deletePlaylist: (id: number) => request(`/api/me/playlists/${id}`, 'DELETE'),
    addTrack: (id: number, track: TrackReference) => request(`/api/me/playlists/${id}/tracks`, 'POST', { source: track.source, sourceId: track.sourceId }),
    removeTrack: (id: number, track: TrackReference) => request(`/api/me/playlists/${id}/tracks/${track.source}/${track.sourceId}`, 'DELETE'),
    likes: async (offset = 0) => (await request<{ tracks: PersonalTrack[] }>(`/api/me/likes?limit=6&offset=${offset}`)).tracks,
    uploads: async (userId: number) => (await request<{ tracks: (PersonalTrack & { uploadedBy: { id: number } })[] }>('/api/local/music')).tracks.filter((track) => track.uploadedBy.id === userId),
    isLiked: async (track: TrackReference) => (await request<{ liked: boolean }>(`/api/me/likes/${track.source}/${track.sourceId}`)).liked,
    setLiked: (track: TrackReference, liked: boolean) => request(`/api/me/likes/${track.source}/${track.sourceId}`, liked ? 'PUT' : 'DELETE'),
  }
}
