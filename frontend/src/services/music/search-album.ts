import { FALLBACK_COVER, type MusicSource, type SearchItem } from '../../shared/music.ts';
import { fetchNeteaseAlbum } from './albums.ts';
import { fetchLocalSearchItems, toNeteaseSearchItems, type SearchFetcher } from './search.ts';

export interface SearchAlbumResult {
  source: MusicSource;
  albumId?: string;
  title: string;
  artist: string;
  coverUrl: string;
  year: string;
  tracks: SearchItem[];
  selectedTrackId: string;
}

export class SearchAlbumError extends Error {}

export async function fetchSearchAlbum(
  song: SearchItem,
  signal: AbortSignal,
  fetcher: SearchFetcher = globalThis.fetch.bind(globalThis),
): Promise<SearchAlbumResult> {
  if (song.kind !== 'song') throw new SearchAlbumError('请先选择一首歌曲。');
  let album = song;
  let tracks: SearchItem[];
  let title: string;
  if (song.source === 'local') {
    if (!song.album || ['未归档', '—'].includes(song.album))
      throw new SearchAlbumError('这首本地歌曲没有专辑信息。');
    const local = await fetchLocalSearchItems(fetcher, signal);
    // 本地上传沿用搜索的艺人和专辑名归组，保留自己的曲目身份。
    tracks = local.filter(
      (item) =>
        item.kind === 'song' &&
        item.artist.toLocaleLowerCase() === song.artist.toLocaleLowerCase() &&
        item.album.toLocaleLowerCase() === song.album.toLocaleLowerCase(),
    );
    title = song.album;
  } else {
    if (!album.albumId) {
      if (!/^[1-9]\d*$/.test(song.sourceId)) throw new SearchAlbumError('歌曲信息无效。');
      const response = await fetcher(`/api/netease/song/detail?ids=${song.sourceId}`, {
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) throw new SearchAlbumError('歌曲的专辑信息暂时无法读取。');
      const detail = (await response.json()) as { code?: number; songs?: unknown };
      if (detail?.code === 200) {
        album =
          toNeteaseSearchItems({ result: { songs: detail.songs } }, 'song').find(
            (item) => item.sourceId === song.sourceId,
          ) ?? song;
      }
    }
    if (!album.albumId) throw new SearchAlbumError('这首歌曲暂未提供专辑信息。');
    const body = await fetchNeteaseAlbum(album.albumId, fetcher, signal);
    const metadata = toNeteaseSearchItems({ result: { albums: [body.album] } }, 'album')[0];
    tracks = toNeteaseSearchItems({ result: { songs: body.songs } }, 'song');
    title = metadata?.title ?? album.album;
    if (metadata) {
      album = {
        ...album,
        artist: metadata.artist === '未知艺术家' ? album.artist : metadata.artist,
        year: metadata.year === '—' ? album.year : metadata.year,
        coverUrl: metadata.coverUrl === FALLBACK_COVER ? album.coverUrl : metadata.coverUrl,
      };
    }
  }
  signal.throwIfAborted();
  const selected = tracks.find((track) => track.sourceId === song.sourceId);
  if (!selected) throw new SearchAlbumError('这张专辑暂未返回所选歌曲。');
  const coverUrl =
    album.coverUrl === FALLBACK_COVER
      ? (tracks.find((track) => track.coverUrl !== FALLBACK_COVER)?.coverUrl ?? FALLBACK_COVER)
      : album.coverUrl;
  return {
    source: album.source,
    albumId: album.albumId,
    title,
    artist: album.artist,
    year: album.year,
    coverUrl,
    tracks: tracks.map((track) => ({
      ...track,
      key: `${track.source}:${track.sourceId}`,
      album: title,
      coverUrl: track.coverUrl === FALLBACK_COVER ? coverUrl : track.coverUrl,
    })),
    selectedTrackId: `${selected.source}:${selected.sourceId}`,
  };
}
