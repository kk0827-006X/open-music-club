import type { DemoAlbum } from './album-data.ts'
import type { SearchItem } from '../../shared/music.ts'

// 统一曲目入口保留原网易云 key，不把专辑视图或 React 引入播放核心。
export function albumTrack(album: DemoAlbum, index = 0): SearchItem {
  const track = album.tracks[index]
  return { key: `netease:${track.id}`, kind: 'song', source: 'netease', sourceId: track.id,
    title: track.title, artist: album.artist, album: album.title, coverUrl: album.coverUrl,
    duration: track.duration, year: album.year, description: album.description }
}
