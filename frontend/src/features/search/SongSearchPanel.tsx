import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QueuePanel } from '../queue/QueuePanel';
import { createSongSearch } from '../../services/music/song-search';
import type { SearchItem } from '../../shared/music';
import { useDismissOnOutsidePointer, useReducedMotion } from '../../shared/react/hooks';
import {
  fetchSearchAlbum,
  SearchAlbumError,
  type SearchAlbumResult,
} from '../../services/music/search-album.ts';

export function SongSearchPanel({
  query,
  open,
  onClose,
  onFocusToggle,
  onPlay,
  onSave,
  onAlbumSelected,
}: {
  query: { term: string; serial: number };
  open: boolean;
  onClose(): void;
  onFocusToggle(): void;
  onPlay(item: SearchItem): Promise<void>;
  onSave(item: SearchItem): void;
  onAlbumSelected?(result: SearchAlbumResult): void;
}) {
  const [items, setItems] = useState<SearchItem[]>([]);
  const [message, setMessage] = useState('正在搜索…');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [albumMessage, setAlbumMessage] = useState('');
  const albumRequest = useRef<AbortController | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const panelRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useDismissOnOutsidePointer(
    open,
    (target) =>
      panelRef.current?.contains(target) ||
      (target instanceof Element && target.closest('[data-search-control]') !== null),
    onClose,
  );
  useEffect(() => {
    const controller = new AbortController();
    const session = createSongSearch(query.term, undefined, controller.signal);
    let pending = false;
    setItems([]);
    setMore(false);
    const next = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      setLoading(true);
      setMessage('正在搜索…');
      try {
        const result = await session.next();
        if (controller.signal.aborted) return;
        setItems((previous) => [...previous, ...result.items]);
        setMore(result.hasMore);
        setMessage(result.warning);
      } catch {
        if (!controller.signal.aborted) setMessage('搜索暂时不可用，请重试。');
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    nextRef.current = () => {
      void next();
    };
    void next();
    return () => {
      controller.abort();
    };
  }, [query]);
  useLayoutEffect(() => {
    setAlbumMessage('');
    return () => albumRequest.current?.abort();
  }, [open, query]);

  const openAlbum = async (item: SearchItem) => {
    albumRequest.current?.abort();
    const request = new AbortController();
    albumRequest.current = request;
    setAlbumMessage('正在查找歌曲所属专辑…');
    try {
      const album = await fetchSearchAlbum(item, request.signal);
      if (!request.signal.aborted) onAlbumSelected?.(album);
    } catch (error) {
      if (!request.signal.aborted)
        setAlbumMessage(
          error instanceof SearchAlbumError ? error.message : '专辑暂时无法打开，请重试。',
        );
    }
  };
  return (
    <QueuePanel
      ref={panelRef}
      mode="search"
      open={open}
      items={items}
      reduced={reduced}
      likes={new Map()}
      pendingLikes={new Set()}
      orderStatus=""
      message={albumMessage || message}
      loading={loading}
      hasMore={more}
      onLoadMore={() => nextRef.current()}
      onClose={onClose}
      onFocusToggle={onFocusToggle}
      onClear={() => {}}
      onRemove={() => {}}
      onLike={() => {}}
      onReorder={() => {}}
      onSave={onSave}
      onOpenAlbum={onAlbumSelected ? (item) => void openAlbum(item) : undefined}
      onPlay={(item) => {
        void onPlay(item).catch(() => setMessage('歌曲暂时无法播放，请尝试其他歌曲。'));
      }}
    />
  );
}
