export type SearchKind = 'song' | 'album' | 'artist'
export type SearchSource = 'local' | 'netease'
export type SourceFilter = SearchSource | 'all'

export interface SearchItem {
  key: string
  kind: SearchKind
  source: SearchSource
  sourceId: string
  title: string
  artist: string
  album: string
  coverUrl: string
  duration: string
  year: string
  description: string
}

type SearchResponse = { ok: boolean; status: number; json(): Promise<unknown> }
export type SearchFetcher = (url: string, options: { credentials: 'same-origin'; signal?: AbortSignal }) => Promise<SearchResponse>

const FALLBACK_COVER = '/images/album-placeholder-01.svg'
const NETEASE_TYPES: Record<SearchKind, number> = { song: 1, album: 10, artist: 100 }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveId(value: unknown): string | null {
  const id = String(value ?? '')
  return /^[1-9]\d*$/.test(id) ? id : null
}

function artistNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((artist) => nonempty(record(artist)?.name)).filter((name): name is string => Boolean(name))
}

function durationText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
  const seconds = Math.floor(value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function releaseYear(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
  const year = new Date(value).getUTCFullYear()
  return year >= 1900 && year <= 2100 ? String(year) : '—'
}

export function safeCoverUrl(value: unknown): string {
  const cover = nonempty(value)
  if (!cover) return FALLBACK_COVER
  if (/^\/api\/local\/music\/[1-9]\d*\/cover$/.test(cover)) return cover
  try {
    const url = new URL(cover)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) {
      url.protocol = 'https:'
      return url.href
    }
  } catch {
    return FALLBACK_COVER
  }
  return FALLBACK_COVER
}

export function filterSearchItems(items: SearchItem[], query: string, source: SourceFilter, kind: SearchKind): SearchItem[] {
  const needle = query.trim().toLocaleLowerCase()
  return items.filter((item) => item.kind === kind
    && (source === 'all' || item.source === source)
    && (!needle || [item.title, item.artist, item.album].some((value) => value.toLocaleLowerCase().includes(needle))))
}

export function toLocalSearchItems(tracks: unknown): SearchItem[] {
  if (!Array.isArray(tracks)) return []
  const songs: SearchItem[] = []
  const albums = new Map<string, SearchItem & { count: number }>()
  const artists = new Map<string, SearchItem & { count: number }>()

  for (const value of tracks) {
    const track = record(value)
    if (!track) continue
    const sourceId = positiveId(track.sourceId)
    const title = nonempty(track.title)
    if (!sourceId || !title) continue
    const artist = artistNames(track.artists).join('、') || '未知艺术家'
    const album = nonempty(record(track.album)?.name)
    const coverUrl = safeCoverUrl(track.coverUrl)
    const uploader = nonempty(record(track.uploadedBy)?.nickname)
    songs.push({
      key: `local:${sourceId}`, kind: 'song', source: 'local', sourceId,
      title, artist, album: album || '未归档', coverUrl,
      duration: durationText(track.durationMs), year: '—',
      description: uploader ? `由 ${uploader} 上传的本地音乐。` : '社区成员上传的本地音乐。',
    })

    if (album) {
      const groupKey = `${artist.toLocaleLowerCase()}\u0000${album.toLocaleLowerCase()}`
      const existing = albums.get(groupKey)
      if (existing) {
        existing.count += 1
        if (existing.coverUrl === FALLBACK_COVER && coverUrl !== FALLBACK_COVER) existing.coverUrl = coverUrl
      } else albums.set(groupKey, {
        key: `local:album:${encodeURIComponent(groupKey)}`, kind: 'album', source: 'local', sourceId,
        title: album, artist, album, coverUrl, duration: '—', year: '—', description: '', count: 1,
      })
    }

    for (const name of artistNames(track.artists)) {
      const groupKey = name.toLocaleLowerCase()
      const existing = artists.get(groupKey)
      if (existing) {
        existing.count += 1
        if (existing.coverUrl === FALLBACK_COVER && coverUrl !== FALLBACK_COVER) existing.coverUrl = coverUrl
      } else artists.set(groupKey, {
        key: `local:artist:${encodeURIComponent(groupKey)}`, kind: 'artist', source: 'local', sourceId,
        title: name, artist: name, album: '—', coverUrl, duration: '—', year: '—', description: '', count: 1,
      })
    }
  }

  return [
    ...songs,
    ...Array.from(albums.values(), ({ count, ...item }) => ({ ...item, description: `${count} 首本地曲目。` })),
    ...Array.from(artists.values(), ({ count, ...item }) => ({ ...item, description: `${count} 首本地曲目。` })),
  ]
}

export function toNeteaseSearchItems(body: unknown, kind: SearchKind): SearchItem[] {
  const result = record(record(body)?.result)
  const key = kind === 'song' ? 'songs' : kind === 'album' ? 'albums' : 'artists'
  const entries = result?.[key]
  if (!Array.isArray(entries)) return []

  return entries.flatMap((value): SearchItem[] => {
    const item = record(value)
    const sourceId = positiveId(item?.id)
    const title = nonempty(item?.name)
    if (!item || !sourceId || !title) return []
    const album = record(item.al) || record(item.album)
    const names = artistNames(item.ar || item.artists)
    const artist = nonempty(record(item.artist)?.name) || names.join('、') || (kind === 'artist' ? title : '未知艺术家')
    const albumName = kind === 'album' ? title : nonempty(album?.name) || '—'
    const picture = kind === 'song' ? album?.picUrl || item.picUrl : item.picUrl || item.img1v1Url
    return [{
      key: `netease:${kind}:${sourceId}`, kind, source: 'netease', sourceId,
      title, artist, album: albumName, coverUrl: safeCoverUrl(picture),
      duration: kind === 'song' ? durationText(item.dt ?? item.duration) : '—',
      year: releaseYear(item.publishTime ?? album?.publishTime),
      description: kind === 'song' ? '来自网易云音乐的歌曲检索结果。' : kind === 'album' ? '来自网易云音乐的专辑检索结果。' : '来自网易云音乐的歌手检索结果。',
    }]
  })
}

export async function fetchLocalSearchItems(fetcher: SearchFetcher = window.fetch.bind(window) as SearchFetcher, signal?: AbortSignal): Promise<SearchItem[]> {
  const response = await fetcher('/api/local/music', { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '本地音乐暂时无法加载')
  const body = record(await response.json())
  if (body?.success !== true || !Array.isArray(body.tracks)) throw new Error('本地音乐暂时无法加载')
  return toLocalSearchItems(body.tracks)
}

export async function fetchNeteaseSearchItems(query: string, kind: SearchKind, fetcher: SearchFetcher = window.fetch.bind(window) as SearchFetcher, signal?: AbortSignal): Promise<SearchItem[]> {
  const keywords = query.trim()
  if (!keywords) return []
  const url = `/api/netease/search?keywords=${encodeURIComponent(keywords)}&type=${NETEASE_TYPES[kind]}`
  const response = await fetcher(url, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '网易云搜索暂时不可用')
  const body = await response.json()
  if (record(body)?.code !== 200) throw new Error('网易云搜索暂时不可用')
  const items = toNeteaseSearchItems(body, kind)
  if (kind !== 'song') return items
  const missing = items.filter((item) => item.coverUrl === FALLBACK_COVER)
  if (!missing.length) return items
  try {
    const ids = missing.map((item) => item.sourceId).join(',')
    const detailResponse = await fetcher(`/api/netease/song/detail?ids=${encodeURIComponent(ids)}`, { credentials: 'same-origin', signal })
    if (!detailResponse.ok) return items
    const details = record(await detailResponse.json())
    if (details?.code !== 200 || !Array.isArray(details.songs)) return items
    const covers = new Map<string, string>()
    for (const value of details.songs) {
      const detail = record(value)
      const id = positiveId(detail?.id)
      if (id) covers.set(id, safeCoverUrl(record(detail?.al)?.picUrl))
    }
    return items.map((item) => ({ ...item, coverUrl: covers.get(item.sourceId) || item.coverUrl }))
  } catch (error) {
    if (signal?.aborted) throw error
    return items
  }
}

export async function resolvePlaybackUrl(
  item: Pick<SearchItem, 'kind' | 'source' | 'sourceId'>,
  fetcher: SearchFetcher = globalThis.fetch.bind(globalThis) as SearchFetcher,
  signal?: AbortSignal,
): Promise<string> {
  const id = positiveId(item.sourceId)
  if (item.kind !== 'song' || !id) throw new Error('当前项目暂不可播放')
  if (item.source === 'local') return `/api/local/music/${id}/stream`
  if (item.source !== 'netease') throw new Error('当前项目暂不可播放')

  const response = await fetcher(`/api/netease/song/url/v1?id=${id}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录' : '歌曲暂不可播放')
  const body = record(await response.json())
  const data = Array.isArray(body?.data) ? record(body.data[0]) : null
  const address = nonempty(data?.url)
  if (body?.code !== 200 || !address) throw new Error('歌曲暂不可播放')
  try {
    const url = new URL(address)
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || !(url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'))) {
      throw new Error('歌曲暂不可播放')
    }
    url.protocol = 'https:'
    return url.href
  } catch {
    throw new Error('歌曲暂不可播放')
  }
}
