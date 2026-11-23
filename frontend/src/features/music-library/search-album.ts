import type { SearchAlbumResult } from '../../services/music/search-album.ts';
import type { SearchAlbum } from './personal-albums.ts';

export interface SearchAlbumSelection {
  album: SearchAlbum;
  trackId: string;
}

export function createSearchAlbumSelection(result: SearchAlbumResult): SearchAlbumSelection {
  return {
    trackId: result.selectedTrackId,
    album: {
      id: 'search-album',
      searchSource: result.source,
      title: result.title,
      artist: result.artist,
      year: result.year,
      genre: '—',
      coverUrl: result.coverUrl,
      accent: '#ac7b42',
      description: '',
      totalTracks: result.tracks.length,
      tracks: result.tracks.map((song) => ({
        id: song.key,
        title: song.title,
        duration: song.duration,
        song,
        playable: true,
      })),
    },
  };
}
