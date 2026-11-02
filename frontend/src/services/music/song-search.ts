import { fetchLocalSearchItems, toNeteaseSearchItems, type SearchFetcher, type SearchItem } from './search'

type SearchBody = { code?: number; songs?: unknown; result?: { songCount?: number }; more?: boolean }

// 每次提交拥有独立游标；仅将歌曲送入结果，不混用本地与网易云来源标识。
export function createSongSearch(query: string, fetcher: SearchFetcher = window.fetch.bind(window), signal?: AbortSignal) {
  const size = 30
  let offset = 0, initialized = false, artistId = '', songMore = true, artistMore = false
  let buffered: SearchItem[] = [], bufferOffset = 0
  const seen = new Set<string>()
  const warnings = new Set<string>()
  async function request(path: string) {
    const response = await fetcher(path, { credentials: 'same-origin', signal })
    if (!response.ok) throw new Error('搜索来源暂时不可用')
    const raw = await response.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('搜索来源暂时不可用')
    const body = raw as SearchBody
    if (body?.code !== 200) throw new Error('搜索来源暂时不可用')
    return body
  }
  const searchUrl = (type: number, limit: number, pageOffset = 0) => `/api/netease/search?keywords=${encodeURIComponent(query.trim())}&type=${type}&limit=${limit}&offset=${pageOffset}`
  async function safe<T>(task: Promise<T>, fallback: T, name: string): Promise<T> {
    try { return await task } catch (error) { if (signal?.aborted) throw error; warnings.add(name); return fallback }
  }
  return {
    async next() {
      if (!initialized) {
        const [local, artist, album] = await Promise.all([
          safe(fetchLocalSearchItems(fetcher, signal), [], '本地'),
          safe(request(searchUrl(100, 1)), null, '歌手'),
          safe(request(searchUrl(10, 1)), null, '专辑'),
        ])
        const needle = query.trim().toLocaleLowerCase()
        buffered = local.filter(item => item.kind === 'song' && [item.title, item.artist, item.album].some(value => value.toLocaleLowerCase().includes(needle)))
        const artistMatch = toNeteaseSearchItems(artist, 'artist')[0]
        artistId = artistMatch?.sourceId ?? ''; artistMore = Boolean(artistId)
        const albumMatch = toNeteaseSearchItems(album, 'album')[0]
        if (albumMatch) {
          const body = await safe(request(`/api/netease/album?id=${albumMatch.sourceId}`), null, '专辑曲目')
          buffered.push(...toNeteaseSearchItems({ result: { songs: body?.songs } }, 'song'))
        }
        initialized = true
      }
      const [songs, artist] = await Promise.all([
        songMore ? safe(request(searchUrl(1, size, offset)), null, '歌曲') : null,
        artistMore ? safe(request(`/api/netease/artist/songs?id=${artistId}&limit=${size}&offset=${offset}`), null, '歌手曲目') : null,
      ])
      const direct = toNeteaseSearchItems(songs, 'song')
      const fromArtist = toNeteaseSearchItems({ result: { songs: artist?.songs } }, 'song')
      songMore = songs !== null && (typeof songs.result?.songCount === 'number' ? offset + size < songs.result.songCount : direct.length >= size)
      artistMore = artist !== null && (typeof artist.more === 'boolean' ? artist.more : fromArtist.length >= size)
      const batch = [...direct, ...fromArtist, ...buffered.slice(bufferOffset, bufferOffset + size)]
      bufferOffset += size; offset += size
      const items = batch.flatMap(item => {
        const key = `${item.source}:${item.sourceId}`
        if (seen.has(key)) return []
        seen.add(key); return [{ ...item, key }]
      })
      return { items, hasMore: songMore || artistMore || bufferOffset < buffered.length,
        warning: warnings.size ? `${[...warnings].join('、')}暂时不可用，已保留其他结果` : '' }
    },
  }
}
