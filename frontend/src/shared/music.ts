export type MusicSource = 'local' | 'netease'
export type TrackReference = { source: MusicSource; sourceId: string }
export type SearchKind = 'song' | 'album' | 'artist'
export type SearchSource = MusicSource
export type SourceFilter = MusicSource | 'all'

// 保留现有 key 与时间显示契约，本轮不改变去重规则或 API 返回结构。
export interface MusicItem extends TrackReference {
  key: string
  kind: SearchKind
  title: string
  artist: string
  album: string
  coverUrl: string
  duration: string
  year: string
  description: string
}
export type Track = MusicItem & { kind: 'song' }
export type SearchItem = MusicItem
export type AlbumTrack = { id: string; title: string; duration: string }
export interface MusicActions {
  play(track: MusicItem): Promise<void>
  enqueue(track: MusicItem): void
}

export const FALLBACK_COVER = '/images/album-placeholder-01.svg'
export function safeCoverUrl(value: unknown): string {
  const cover = typeof value === 'string' && value.trim() ? value.trim() : null
  if (!cover) return FALLBACK_COVER
  if (/^\/api\/local\/music\/[1-9]\d*\/cover$/.test(cover)) return cover
  try {
    const url = new URL(cover)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) {
      url.protocol = 'https:'
      return url.href
    }
  } catch { return FALLBACK_COVER }
  return FALLBACK_COVER
}
