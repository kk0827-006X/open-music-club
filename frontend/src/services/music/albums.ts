import type { AlbumTrack } from '../../shared/music.ts'

type AlbumResponse = { ok: boolean; json(): Promise<unknown> }
type AlbumFetcher = (url: string, options: { credentials: 'same-origin'; signal?: AbortSignal }) => Promise<AlbumResponse>

export async function fetchAlbumTracks(
  albumId: string,
  fetcher: AlbumFetcher = window.fetch.bind(window),
  signal?: AbortSignal,
): Promise<AlbumTrack[]> {
  if (!/^[1-9]\d*$/.test(albumId)) throw new Error('专辑编号无效')
  const response = await fetcher(`/api/netease/album?id=${albumId}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('专辑曲目暂时不可用')
  const body = await response.json() as { code?: number; songs?: unknown }
  if (body?.code !== 200 || !Array.isArray(body.songs)) throw new Error('专辑曲目暂时不可用')
  const tracks = body.songs.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return []
    const song = value as { id?: unknown; name?: unknown; dt?: unknown; duration?: unknown }
    const id = String(song.id ?? '')
    if (!/^[1-9]\d*$/.test(id) || typeof song.name !== 'string' || !song.name.trim()) return []
    const milliseconds = typeof song.dt === 'number' ? song.dt : song.duration
    const seconds = typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds >= 0
      ? Math.floor(milliseconds / 1000) : 0
    return [{ id, title: song.name.trim(), duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }]
  })
  if (tracks.length === 0) throw new Error('专辑曲目暂时不可用')
  return tracks
}
