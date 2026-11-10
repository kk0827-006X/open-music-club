import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SearchItem } from '../../../shared/music.ts';
import type { createPersonalLibraryClient } from '../../../services/music/personal-library.ts';
import type { PlayerState } from '../player-core.ts';
import type { PlayerQueuePort } from './usePlayerQueue.ts';

type QueueLikes = ReadonlyMap<string, boolean>;

export function usePlayerLikes({
  personalLibrary,
  queue,
  stateRef,
  collectionChangedRef,
  disposedRef,
  collectionNotice,
  queueOpen,
  queryVersion,
}: {
  personalLibrary: ReturnType<typeof createPersonalLibraryClient>;
  queue: PlayerQueuePort;
  stateRef: RefObject<PlayerState>;
  collectionChangedRef: RefObject<() => void>;
  disposedRef: RefObject<boolean>;
  collectionNotice(message: string): void;
  queueOpen: boolean;
  queryVersion: number;
}) {
  const [liked, setLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [pendingLikes, setPendingLikes] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [queueLikes, setQueueLikesState] = useState<QueueLikes>(() => new Map<string, boolean>());
  const likeRequestRef = useRef(0);
  const pendingLikesRef = useRef<ReadonlySet<string>>(pendingLikes);
  pendingLikesRef.current = pendingLikes;
  const queueLikesRef = useRef<QueueLikes>(queueLikes);
  queueLikesRef.current = queueLikes;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // 收藏状态请求带请求序号，歌曲切换后旧的响应不会再写入当前按钮。
  const syncLikedFor = useCallback(
    async (track: SearchItem | null) => {
      if (disposedRef.current) return;
      const current = ++likeRequestRef.current;
      setLikePending(true);
      if (!track) {
        setLikePending(false);
        return;
      }
      try {
        const value = await personalLibrary.isLiked(track);
        if (disposedRef.current || current !== likeRequestRef.current) return;
        setLiked(value);
        setLikePending(false);
      } catch (error) {
        if (!disposedRef.current && current === likeRequestRef.current) {
          setLikePending(false);
          collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败');
        }
      }
    },
    [collectionNotice, personalLibrary],
  );

  const addPendingLike = useCallback((key: string) => {
    if (pendingLikesRef.current.has(key)) return;
    const next = new Set(pendingLikesRef.current);
    next.add(key);
    pendingLikesRef.current = next;
    setPendingLikes(next);
  }, []);

  const removePendingLike = useCallback((key: string) => {
    if (!pendingLikesRef.current.has(key)) return;
    const next = new Set(pendingLikesRef.current);
    next.delete(key);
    pendingLikesRef.current = next;
    setPendingLikes(next);
  }, []);

  const setQueueLike = useCallback((key: string, value: boolean) => {
    const next = new Map(queueLikesRef.current);
    next.set(key, value);
    queueLikesRef.current = next;
    setQueueLikesState(next);
  }, []);

  const syncQueueLikes = useCallback(
    (refresh = false) => {
      for (const item of queueRef.current.items) {
        if (pendingLikesRef.current.has(item.key)) continue;
        if (!refresh && queueLikesRef.current.has(item.key)) continue;
        addPendingLike(item.key);
        void personalLibrary
          .isLiked(item)
          .then((value) => {
            if (!disposedRef.current) setQueueLike(item.key, value);
          })
          .catch((error) => {
            if (!disposedRef.current)
              collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败');
          })
          .finally(() => {
            if (!disposedRef.current) removePendingLike(item.key);
          });
      }
    },
    [addPendingLike, collectionNotice, personalLibrary, removePendingLike, setQueueLike],
  );

  const toggleLike = useCallback(
    async (track: SearchItem) => {
      if (disposedRef.current || pendingLikesRef.current.has(track.key)) return;
      addPendingLike(track.key);
      try {
        const currentlyLiked = await personalLibrary.isLiked(track);
        if (disposedRef.current) return;
        await personalLibrary.setLiked(track, !currentlyLiked);
        if (disposedRef.current) return;
        setQueueLike(track.key, !currentlyLiked);
        if (stateRef.current.track?.key === track.key) setLiked(!currentlyLiked);
        collectionNotice(currentlyLiked ? '已取消喜爱' : '已保存到喜爱');
        collectionChangedRef.current();
        void syncLikedFor(stateRef.current.track);
      } catch (error) {
        if (!disposedRef.current)
          collectionNotice(error instanceof Error ? error.message : '收藏保存失败');
      } finally {
        if (stateRef.current.track?.key === track.key && !disposedRef.current)
          setLikePending(false);
        if (!disposedRef.current) removePendingLike(track.key);
      }
    },
    [
      addPendingLike,
      collectionNotice,
      personalLibrary,
      removePendingLike,
      setQueueLike,
      syncLikedFor,
    ],
  );

  const onPlayerLike = useCallback(() => {
    const track = stateRef.current.track;
    if (!track || pendingLikesRef.current.has(track.key)) return;
    void toggleLike(track);
  }, [toggleLike]);

  const onQueueItemLike = useCallback(
    (item: SearchItem) => {
      if (pendingLikesRef.current.has(item.key)) return;
      void toggleLike(item);
    },
    [toggleLike],
  );

  const clearLiked = useCallback(() => {
    likeRequestRef.current += 1;
    setLiked(false);
    setLikePending(false);
  }, []);
  useEffect(() => {
    pendingLikesRef.current = new Set<string>();
    setPendingLikes(new Set<string>());
    return () => {
      likeRequestRef.current += 1;
    };
  }, []);
  useEffect(() => {
    if (queueOpen) syncQueueLikes(true);
  }, [queueOpen, syncQueueLikes]);

  useEffect(() => {
    if (queueOpen) syncQueueLikes(false);
  }, [queueOpen, queryVersion, syncQueueLikes]);

  return {
    liked,
    likePending,
    pendingLikes,
    queueLikes,
    syncLikedFor,
    clearLiked,
    onPlayerLike,
    onQueueItemLike,
  };
}
