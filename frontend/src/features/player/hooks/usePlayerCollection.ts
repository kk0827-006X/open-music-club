import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { SearchItem } from '../../../shared/music.ts';
import type {
  createPersonalLibraryClient,
  UserPlaylist,
} from '../../../services/music/personal-library.ts';

const COLLECTION_NOTICE_DURATION = 5000;

export function usePlayerCollection({
  personalLibrary,
  disposedRef,
  collectionChangedRef,
}: {
  personalLibrary: ReturnType<typeof createPersonalLibraryClient>;
  disposedRef: RefObject<boolean>;
  collectionChangedRef: RefObject<() => void>;
}) {
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState('');
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistId, setPlaylistId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const noticeTimerRef = useRef(0);
  const collectionBusyRef = useRef(false);
  const playlistCandidateRef = useRef<SearchItem | null>(null);

  const collectionNotice = useCallback((message: string) => {
    if (disposedRef.current) return;
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      if (!disposedRef.current) setNotice(null);
    }, COLLECTION_NOTICE_DURATION);
  }, []);

  const closeCollection = useCallback(() => {
    if (disposedRef.current) return;
    setCollectionOpen(false);
  }, []);

  const choosePlaylist = useCallback(
    async (track: SearchItem) => {
      if (disposedRef.current || collectionBusyRef.current) return;
      collectionBusyRef.current = true;
      setCollectionBusy(true);
      playlistCandidateRef.current = track;
      setCollectionMessage('正在读取歌单…');
      setPlaylists([]);
      setPlaylistId('');
      setCollectionOpen(true);
      try {
        const all = await personalLibrary.playlists();
        if (disposedRef.current) return;
        setPlaylists(all);
        setPlaylistId(all[0] ? String(all[0].id) : '');
        setCollectionMessage(
          all.length ? `将「${track.title}」保存到歌单。` : '还没有歌单，请先到用户页面新建。',
        );
      } catch (error) {
        if (!disposedRef.current)
          setCollectionMessage(error instanceof Error ? error.message : '歌单读取失败');
      } finally {
        collectionBusyRef.current = false;
        if (!disposedRef.current) setCollectionBusy(false);
      }
    },
    [personalLibrary],
  );

  const submitCollection = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const candidate = playlistCandidateRef.current;
      const id = Number(playlistId);
      if (!candidate || !id || collectionBusyRef.current) return;
      collectionBusyRef.current = true;
      setCollectionBusy(true);
      try {
        await personalLibrary.addTrack(id, candidate);
        if (disposedRef.current) return;
        setCollectionOpen(false);
        collectionNotice('歌曲已保存到歌单');
        collectionChangedRef.current();
      } catch (error) {
        if (!disposedRef.current) {
          setCollectionMessage(error instanceof Error ? error.message : '保存失败');
        }
      } finally {
        collectionBusyRef.current = false;
        if (!disposedRef.current) setCollectionBusy(false);
      }
    },
    [collectionNotice, personalLibrary, playlistId],
  );

  const openQueueItemSave = useCallback(
    (item: SearchItem) => {
      void choosePlaylist(item);
    },
    [choosePlaylist],
  );

  useEffect(() => {
    collectionBusyRef.current = false;
    return () => window.clearTimeout(noticeTimerRef.current);
  }, []);

  return {
    collectionOpen,
    collectionBusy,
    collectionMessage,
    playlists,
    playlistId,
    setPlaylistId,
    notice,
    collectionNotice,
    closeCollection,
    choosePlaylist,
    submitCollection,
    openQueueItemSave,
  };
}
