import type { DemoAlbum } from './album-data.ts';
import type { MusicSource, SearchItem } from '../../shared/music.ts';
import {
  toPersonalSong,
  type ArchiveCollections,
  type createPersonalLibraryClient,
  type PersonalTrack,
  type UserPlaylist,
  type UserProfile,
} from '../../services/music/personal-library.ts';

type TrackCollection = Omit<DemoAlbum, 'coverUrl' | 'tracks' | 'personal' | 'searchSource'> & {
  coverUrl: string | null;
  tracks: Array<{
    id: string;
    title: string;
    duration: string;
    song: SearchItem;
    playable: boolean;
  }>;
};
export type PersonalAlbum = TrackCollection & {
  personal: 'favorites' | 'recent' | 'playlist';
  playlistId?: number;
  searchSource?: never;
};
export type SearchAlbum = TrackCollection & { searchSource: MusicSource; personal?: never };
export type LibraryAlbum = DemoAlbum | PersonalAlbum | SearchAlbum;

export function personalAlbums(
  profile: UserProfile | undefined,
  playlists: readonly UserPlaylist[],
  summary: ArchiveCollections | undefined,
): PersonalAlbum[] {
  const artist = profile?.nickname ?? '我的音乐';
  const album = (
    id: string,
    title: string,
    personal: PersonalAlbum['personal'],
    totalTracks: number,
    coverUrl: string | null,
    description: string,
  ): PersonalAlbum => ({
    id,
    title,
    artist,
    year: '—',
    genre: '个人专辑',
    accent: '#ac7b42',
    personal,
    totalTracks,
    coverUrl,
    description,
    tracks: [],
  });
  const result: PersonalAlbum[] = [];
  if (summary?.favoritesCount) {
    result.push(
      album(
        'favorites',
        '收藏歌曲',
        'favorites',
        summary.favoritesCount,
        profile?.avatarUrl ?? null,
        '我收藏的歌曲',
      ),
    );
  }
  if (summary?.recent?.count) {
    result.push(
      album(
        'recent',
        '最近播放',
        'recent',
        summary.recent.count,
        summary.recent.coverUrl,
        '最近播放的不同歌曲',
      ),
    );
  }
  for (const playlist of playlists) {
    result.push({
      ...album(
        `playlist:${playlist.id}`,
        playlist.name,
        'playlist',
        playlist.trackCount,
        playlist.coverUrl ?? null,
        playlist.description ?? '',
      ),
      playlistId: playlist.id,
    });
  }
  return result;
}

export async function loadPersonalAlbum(
  client: ReturnType<typeof createPersonalLibraryClient>,
  album: PersonalAlbum,
  signal: AbortSignal,
): Promise<PersonalAlbum> {
  let tracks: PersonalTrack[];
  if (album.personal === 'recent') {
    tracks = await client.recentPlayed(signal);
  } else if (album.playlistId !== undefined) {
    tracks = (await client.playlist(album.playlistId, signal)).tracks;
  } else {
    const unique = new Map<string, PersonalTrack>();
    const limit = 50;
    for (let offset = 0; ; offset += limit) {
      const page = await client.likesPage(offset, limit, signal);
      page.forEach((track) => unique.set(track.trackKey, track));
      if (page.length < limit) break;
    }
    tracks = [...unique.values()];
  }
  return {
    ...album,
    totalTracks: tracks.length,
    tracks: tracks.map((track) => {
      const song = toPersonalSong(track);
      return {
        id: song.key,
        title: song.title,
        duration: song.duration,
        song,
        playable: track.playable,
      };
    }),
  };
}
