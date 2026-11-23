import type { LibraryAlbum } from './personal-albums.ts';
import { FALLBACK_COVER, type SearchItem } from '../../shared/music.ts';

// 统一曲目入口保留原网易云 key，不把专辑视图或 React 引入播放核心。
export function albumTrack(album: LibraryAlbum, index = 0): SearchItem {
  const track = album.tracks[index];
  if ('song' in track) return track.song;
  return {
    key: `netease:${track.id}`,
    kind: 'song',
    source: 'netease',
    sourceId: track.id,
    title: track.title,
    artist: album.artist,
    album: album.title,
    coverUrl: album.coverUrl ?? FALLBACK_COVER,
    duration: track.duration,
    year: album.year,
    description: album.description,
  };
}
