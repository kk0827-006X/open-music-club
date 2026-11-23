import { safeCoverUrl, type SearchItem } from '../../shared/music.ts';
import { formatDurationMs } from '../../shared/format.ts';

import type { TrackReference } from '../../shared/music.ts';
export type { TrackReference } from '../../shared/music.ts';
export type PersonalTrack = TrackReference & {
  trackKey: string;
  title: string;
  artists: { name: string }[];
  album: { name: string | null };
  durationMs: number;
  coverUrl: string | null;
  playable: boolean;
  liked?: boolean;
  entryId?: number;
};
export type UserPlaylist = {
  id: number;
  name: string;
  description: string | null;
  trackCount: number;
  coverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type UserProfile = { id: number; nickname: string; avatarUrl: string | null };
export type ArchiveCollections = {
  favoritesCount: number;
  recent: { count: number; coverUrl: string | null };
};
type Fetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export class PersonalLibraryError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function toPersonalSong(track: PersonalTrack): SearchItem {
  return {
    key: `${track.source}:${track.sourceId}`,
    kind: 'song',
    source: track.source,
    sourceId: track.sourceId,
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join('、') || '未知艺术家',
    album: track.album.name || '未归档',
    coverUrl: safeCoverUrl(track.coverUrl),
    duration: formatDurationMs(track.durationMs),
    year: '—',
    description: '',
  };
}

export function createPersonalLibraryClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  let playbackCsrfToken: string | undefined;
  const request = async <T>(
    url: string,
    method = 'GET',
    body?: object | FormData,
    keepalive = false,
    preparedToken?: string,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      // 普通写操作读取当前会话令牌；队列使用预取令牌，失效后重新获取。
      const token = preparedToken
        ? { csrfToken: preparedToken }
        : await request<{ csrfToken: string }>(
            '/api/security/csrf-token',
            'GET',
            undefined,
            keepalive,
            undefined,
            signal,
          );
      if (!token.csrfToken) throw new Error('无法建立安全会话，请重新登录');
      headers['X-CSRF-Token'] = token.csrfToken;
    }
    const multipart = body instanceof FormData;
    if (body && !multipart) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetcher(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        ...(signal ? { signal } : {}),
        ...(keepalive ? { keepalive: true } : {}),
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('无法连接服务器，请稍后重试');
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: '提交内容无效，请检查后重试',
        401: '登录已失效，请重新登录',
        403: '权限或安全校验失败，请刷新后重试',
        404: '内容已不存在，请刷新列表',
        409: '内容已存在或状态发生变化，请刷新列表',
        413: '图片不能超过 5 MB',
        429: '操作过于频繁，请稍后重试',
        502: '音乐服务暂时不可用，请稍后重试',
      };
      throw new PersonalLibraryError(
        messages[response.status] || '保存或读取失败，请稍后重试',
        response.status,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error('服务器响应异常，请稍后重试');
    }
  };
  const preparePlaybackToken = async (signal?: AbortSignal) => {
    playbackCsrfToken = (
      await request<{ csrfToken: string }>(
        '/api/security/csrf-token',
        'GET',
        undefined,
        true,
        undefined,
        signal,
      )
    ).csrfToken;
    if (!playbackCsrfToken) throw new Error('无法建立安全会话，请重新登录');
    return playbackCsrfToken;
  };
  const savePlayback = async (url: string, body: object, signal?: AbortSignal) => {
    const token = playbackCsrfToken || (await preparePlaybackToken(signal));
    try {
      return await request(url, 'PUT', body, true, token, signal);
    } catch (error) {
      if (error instanceof PersonalLibraryError && [401, 403].includes(error.status))
        playbackCsrfToken = undefined;
      throw error;
    }
  };
  const read = <T>(url: string, signal?: AbortSignal) =>
    request<T>(url, 'GET', undefined, false, undefined, signal);
  const likesPage = async (offset: number, limit: number, signal?: AbortSignal) =>
    (
      await read<{ tracks: PersonalTrack[] }>(
        `/api/me/likes?limit=${limit}&offset=${offset}`,
        signal,
      )
    ).tracks;
  return {
    archiveCollections: (signal?: AbortSignal) =>
      read<ArchiveCollections>('/api/me/archive-collections', signal),
    recentPlayed: async (signal?: AbortSignal) =>
      (await read<{ tracks: PersonalTrack[] }>('/api/me/recent-played', signal)).tracks,
    lastPlayed: async (signal: AbortSignal) =>
      (
        await request<{ track: PersonalTrack | null }>(
          '/api/me/last-played',
          'GET',
          undefined,
          false,
          undefined,
          signal,
        )
      ).track,
    saveLastPlayed: (
      { source, sourceId }: TrackReference,
      startedAt: number,
      signal: AbortSignal,
    ) => savePlayback('/api/me/last-played', { source, sourceId, startedAt }, signal),
    queue: async () => {
      // 登录后的客户端只保留本会话令牌；提前准备，关页时无需先等另一个请求。
      const [queue] = await Promise.all([
        request<{ tracks: PersonalTrack[] }>('/api/me/queue'),
        preparePlaybackToken(),
      ]);
      return queue.tracks;
    },
    saveQueue: (tracks: readonly TrackReference[]) =>
      savePlayback('/api/me/queue', {
        tracks: tracks.map(({ source, sourceId }) => ({ source, sourceId })),
      }),
    profile: async (signal?: AbortSignal) =>
      (await read<{ profile: UserProfile }>('/api/me/profile', signal)).profile,
    uploadAvatar: async (file: File) => {
      const data = new FormData();
      data.append('file', file);
      return (await request<{ profile: UserProfile }>('/api/me/avatar', 'PUT', data)).profile;
    },
    playlists: async (signal?: AbortSignal) => {
      const all: UserPlaylist[] = [];
      for (let offset = 0; offset < 100; offset += 50) {
        const page = (
          await read<{ playlists: UserPlaylist[] }>(
            `/api/me/playlists?limit=50&offset=${offset}`,
            signal,
          )
        ).playlists;
        all.push(...page);
        if (page.length < 50) break;
      }
      return all;
    },
    playlist: (id: number, signal?: AbortSignal) =>
      read<{ playlist: UserPlaylist; tracks: PersonalTrack[] }>(`/api/me/playlists/${id}`, signal),
    createPlaylist: async (name: string) =>
      (await request<{ playlist: UserPlaylist }>('/api/me/playlists', 'POST', { name })).playlist,
    renamePlaylist: (id: number, name: string) =>
      request(`/api/me/playlists/${id}`, 'PATCH', { name }),
    deletePlaylist: (id: number) => request(`/api/me/playlists/${id}`, 'DELETE'),
    addTrack: (id: number, track: TrackReference) =>
      request(`/api/me/playlists/${id}/tracks`, 'POST', {
        source: track.source,
        sourceId: track.sourceId,
      }),
    removeTrack: (id: number, track: TrackReference) =>
      request(`/api/me/playlists/${id}/tracks/${track.source}/${track.sourceId}`, 'DELETE'),
    likes: (offset = 0) => likesPage(offset, 6),
    likesPage,
    uploads: async (userId: number) =>
      (
        await request<{ tracks: (PersonalTrack & { uploadedBy: { id: number } })[] }>(
          '/api/local/music',
        )
      ).tracks.filter((track) => track.uploadedBy.id === userId),
    isLiked: async (track: TrackReference) =>
      (await request<{ liked: boolean }>(`/api/me/likes/${track.source}/${track.sourceId}`)).liked,
    setLiked: (track: TrackReference, liked: boolean) =>
      request(`/api/me/likes/${track.source}/${track.sourceId}`, liked ? 'PUT' : 'DELETE'),
  };
}
