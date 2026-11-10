import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { SearchItem, TrackReference } from '../../../shared/music.ts';
import {
  toPersonalSong,
  type createPersonalLibraryClient,
} from '../../../services/music/personal-library.ts';
import type { PlayerController, PlayerState } from '../player-core.ts';

// 队列能力由原装配入口注入，hook 不新增跨 feature 导入。
export interface PlayerQueuePort {
  readonly items: readonly SearchItem[];
  add(track: SearchItem): void;
  remove(key: string): void;
  clear(): void;
  restore(tracks: readonly SearchItem[]): void;
  previous(key: string): SearchItem | null;
  next(key: string): SearchItem | null;
}
interface PersistenceOptions {
  read(): readonly SearchItem[];
  restore(tracks: SearchItem[]): void;
  load(): Promise<SearchItem[]>;
  save(tracks: TrackReference[]): Promise<unknown>;
  notice(message: string): void;
}
interface PersistencePort {
  changed(options?: { replace?: boolean }): void;
  start(): Promise<void>;
  retry(): Promise<void>;
  flush(): Promise<void>;
  destroy(): void;
}

export function usePlayerQueue({
  queue,
  player,
  stateRef,
  defaultTrackRef,
  personalLibraryRef,
  disposedRef,
  collectionNotice,
  setQueueOpen,
  onAdded,
  createPersistence,
}: {
  queue: PlayerQueuePort;
  player: PlayerController;
  stateRef: RefObject<PlayerState>;
  defaultTrackRef: RefObject<SearchItem>;
  personalLibraryRef: RefObject<ReturnType<typeof createPersonalLibraryClient>>;
  disposedRef: RefObject<boolean>;
  collectionNotice(message: string): void;
  setQueueOpen(open: boolean): void;
  onAdded(): void;
  createPersistence(options: PersistenceOptions): PersistencePort;
}) {
  const [queueVersion, setQueueVersion] = useState(0);
  const [queueOrderStatus, setQueueOrderStatus] = useState('');
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const persistenceRef = useRef<PersistencePort | null>(null);
  const enqueueTrack = useCallback(
    (track: SearchItem) => {
      if (disposedRef.current) return;
      const items = queueRef.current.items;
      if (items.length >= 500 && !items.some((item) => item.key === track.key)) {
        collectionNotice('播放队列最多保存 500 首，请先移除部分歌曲');
        return;
      }
      queueRef.current.add(track);
      setQueueVersion((version) => version + 1);
      persistenceRef.current?.changed();
      onAdded();
    },
    [collectionNotice, onAdded],
  );

  const commitQueue = useCallback(() => {
    setQueueVersion((version) => version + 1);
    persistenceRef.current?.changed();
  }, []);

  const handleReorder = useCallback(
    (items: SearchItem[], movedKey?: string) => {
      const current = queueRef.current;
      const previousKeys = current.items.map((item) => item.key);
      const key =
        movedKey && items.some((item) => item.key === movedKey)
          ? movedKey
          : items.find((item, index) => item.key !== previousKeys[index])?.key;
      current.restore(items);
      commitQueue();
      const destination = key ? items.findIndex((item) => item.key === key) : -1;
      setQueueOrderStatus(destination >= 0 ? `歌曲已移动到第 ${destination + 1} 位` : '');
    },
    [commitQueue],
  );

  const play = useCallback((track: SearchItem) => player.play(track), [player]);
  const replaceAndPlay = useCallback(
    async (tracks: readonly SearchItem[]) => {
      if (disposedRef.current) return;
      const songs = tracks.filter((track) => track.kind === 'song');
      if (!songs.length) return;
      if (songs.length > 500) {
        collectionNotice('专辑曲目超过播放队列 500 首上限');
        return;
      }
      queueRef.current.restore(songs);
      player.clear();
      setQueueVersion((version) => version + 1);
      persistenceRef.current?.changed({ replace: true });
      try {
        await player.play(queueRef.current.items[0]);
      } catch {
        collectionNotice('专辑播放失败，请重新尝试播放。');
      }
    },
    [collectionNotice, player],
  );
  const playSafely = useCallback(
    (track: SearchItem) => {
      void player.play(track).catch(() => undefined);
    },
    [player],
  );
  const playQueueItem = useCallback(
    (item: SearchItem) => {
      playSafely(item);
    },
    [playSafely],
  );
  const removeQueueItem = useCallback(
    (key: string) => {
      queueRef.current.remove(key);
      if (stateRef.current.track?.key === key) player.clear();
      commitQueue();
    },
    [commitQueue, player],
  );
  const clearQueue = useCallback(() => {
    queueRef.current.clear();
    player.clear();
    commitQueue();
    setQueueOpen(false);
  }, [commitQueue, player, setQueueOpen]);
  const playPrevious = useCallback(() => {
    const track = stateRef.current.track;
    if (!track) return;
    const previous = queueRef.current.previous(track.key);
    if (previous) playSafely(previous);
  }, [playSafely]);
  const playNext = useCallback(() => {
    const track = stateRef.current.track;
    if (!track) return;
    const next = queueRef.current.next(track.key);
    if (next) playSafely(next);
  }, [playSafely]);
  const togglePlayback = useCallback(() => {
    if (!stateRef.current.track) {
      playSafely(defaultTrackRef.current);
      return;
    }
    void player.toggle().catch(() => undefined);
  }, [playSafely, player]);
  const seekToPointer = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!stateRef.current.track || !Number.isFinite(stateRef.current.duration)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width) return;
      player.seek((event.clientX - bounds.left) / bounds.width);
    },
    [player],
  );
  const changeVolume = useCallback(
    (value: number) => {
      // 共享 VolumeSlider 以 0..1 受控值工作；边界再次收敛，避免异常值写进音频元素。
      const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      player.setVolume(next);
    },
    [player],
  );

  // 持久化服务保持原有串行写入与加载竞争处理；视图卸载只销毁该服务，不销毁注入的播放器。
  useEffect(() => {
    const service = createPersistence({
      read: () => queueRef.current.items,
      load: async () => (await personalLibraryRef.current.queue()).map(toPersonalSong),
      save: (tracks) => personalLibraryRef.current.saveQueue(tracks),
      restore: (tracks) => {
        queueRef.current.restore(tracks);
        setQueueVersion((version) => version + 1);
        persistenceRef.current?.changed();
      },
      notice: (message) => collectionNotice(message),
    });
    persistenceRef.current = service;
    const retryQueue = () => {
      void service.retry();
    };
    const flushQueue = () => {
      void service.flush();
    };
    window.addEventListener('online', retryQueue);
    window.addEventListener('pagehide', flushQueue);
    void service.start();
    return () => {
      window.removeEventListener('online', retryQueue);
      window.removeEventListener('pagehide', flushQueue);
      service.destroy();
      if (persistenceRef.current === service) persistenceRef.current = null;
    };
  }, [collectionNotice]);

  const queueSnapshot = useMemo(() => [...queue.items], [queue, queueVersion]);
  const removeQueueTrack = useCallback(
    (item: SearchItem) => removeQueueItem(item.key),
    [removeQueueItem],
  );

  return {
    queueVersion,
    queueOrderStatus,
    queueSnapshot,
    enqueueTrack,
    play,
    replaceAndPlay,
    playPrevious,
    playNext,
    togglePlayback,
    seekToPointer,
    changeVolume,
    playQueueItem,
    removeQueueTrack,
    clearQueue,
    handleReorder,
  };
}
