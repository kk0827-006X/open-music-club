import { useEffect, useMemo, useReducer, useState } from 'react';
import type {
  ArchiveCollections,
  createPersonalLibraryClient,
  UserPlaylist,
  UserProfile,
} from '../../services/music/personal-library.ts';
import { personalAlbums } from './personal-albums.ts';

export function usePersonalAlbums(
  client: ReturnType<typeof createPersonalLibraryClient>,
  active: boolean,
  playbackRevision: number,
) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [profile, setProfile] = useState<UserProfile>();
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [summary, setSummary] = useState<ArchiveCollections>();
  useEffect(() => {
    if (!active || !client.archiveCollections) return;
    const request = new AbortController();
    const { signal } = request;
    void client
      .profile(signal)
      .then((value) => {
        if (!signal.aborted) setProfile(value);
      })
      .catch(() => undefined);
    void client
      .playlists(signal)
      .then((value) => {
        if (!signal.aborted) setPlaylists(value);
      })
      .catch(() => undefined);
    return () => request.abort();
  }, [active, client, revision]);
  useEffect(() => {
    if (!active || !client.archiveCollections) return;
    const request = new AbortController();
    void client
      .archiveCollections(request.signal)
      .then((value) => {
        if (!request.signal.aborted) setSummary(value);
      })
      .catch(() => undefined);
    return () => request.abort();
  }, [active, client, playbackRevision, revision]);
  return {
    albums: useMemo(
      () => personalAlbums(profile, playlists, summary),
      [profile, playlists, summary],
    ),
    refresh,
  };
}
