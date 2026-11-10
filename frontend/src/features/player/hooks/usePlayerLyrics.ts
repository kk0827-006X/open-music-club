import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SearchItem } from '../../../shared/music.ts';
import { currentLyricIndex, loadTrackLyrics, type LyricLine } from '../../../player-lyrics.ts';

export function usePlayerLyrics({
  disposedRef,
  expanded,
  currentTime,
  reduced,
}: {
  disposedRef: RefObject<boolean>;
  expanded: boolean;
  currentTime: number;
  reduced: boolean;
}) {
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricMessage, setLyricMessage] = useState<string | null>('播放音乐后将在这里显示歌词。');
  const lyricScrollRef = useRef<HTMLDivElement | null>(null);
  const lastLyricScrollRef = useRef(-2);
  const lyricRequestRef = useRef(0);
  const lyricAbortRef = useRef<AbortController | null>(null);
  const requestLyrics = useCallback((track: SearchItem) => {
    lyricRequestRef.current += 1;
    const request = lyricRequestRef.current;
    lyricAbortRef.current?.abort();
    const controller = new AbortController();
    lyricAbortRef.current = controller;
    lastLyricScrollRef.current = -2;
    setLyricLines([]);
    setLyricMessage(track.source === 'local' ? '本地音乐暂无歌词。' : '正在读取歌词…');
    void loadTrackLyrics(track, undefined, controller.signal).then((lines) => {
      if (disposedRef.current || request !== lyricRequestRef.current) return;
      setLyricLines(lines);
      setLyricMessage(lines.length ? null : '此歌曲暂无歌词。');
    });
  }, []);

  const clearLyrics = useCallback(() => {
    lyricRequestRef.current += 1;
    lyricAbortRef.current?.abort();
    lyricAbortRef.current = null;
    lastLyricScrollRef.current = -2;
    setLyricLines([]);
    setLyricMessage('播放音乐后将在这里显示歌词。');
  }, []);

  useEffect(() => {
    if (!expanded) {
      lastLyricScrollRef.current = -2;
      return;
    }
    if (lyricLines.length === 0) return;
    const index = currentLyricIndex(lyricLines, currentTime);
    if (index < 0 || index === lastLyricScrollRef.current) return;
    lastLyricScrollRef.current = index;
    const container = lyricScrollRef.current;
    const line = container?.children.item(index);
    if (container && line instanceof HTMLElement) {
      // 只调整歌词容器；scrollIntoView 会连带滚动 overflow:hidden 的播放器和外层页面。
      const lineBounds = line.getBoundingClientRect();
      const top =
        container.scrollTop +
        lineBounds.top -
        container.getBoundingClientRect().top -
        container.clientTop +
        lineBounds.height / 2 -
        container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight)),
        behavior: reduced ? ('instant' as ScrollBehavior) : 'smooth',
      });
    }
  }, [expanded, lyricLines, reduced, currentTime]);

  useEffect(
    () => () => {
      lyricRequestRef.current += 1;
      lyricAbortRef.current?.abort();
    },
    [],
  );

  return { lyricLines, lyricMessage, lyricScrollRef, requestLyrics, clearLyrics };
}
