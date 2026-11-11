import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  PersonalLibraryError,
  toPersonalSong,
  type PersonalTrack,
  type UserPlaylist,
} from '../../../services/music/personal-library.ts';
import type { SearchItem } from '../../../shared/music.ts';
import { useSectionTransition } from '../../../shared/react/page-transitions.ts';
import type { PersonalLibraryClient, UserSection } from '../types.ts';
import type { useProfile } from './use-profile.ts';

export async function playPlaylistTracks(
  tracks: PersonalTrack[],
  options: {
    play?: (song: SearchItem) => Promise<unknown>;
    enqueue?: (song: SearchItem) => void;
  },
) {
  const songs = tracks.filter((track) => track.playable).map(toPersonalSong);
  if (!songs.length) return 0;
  // 不创建新播放器；全部可用曲目交给原队列，顺序与歌单一致。
  songs.forEach((song) => options.enqueue?.(song));
  await options.play?.(songs[0]);
  return songs.length;
}

export function usePersonalLibraryData({
  api,
  profile,
  unmountedRef,
  active,
  changed,
}: {
  api: PersonalLibraryClient;
  profile: ReturnType<typeof useProfile>;
  unmountedRef: RefObject<boolean>;
  active: boolean;
  changed?: () => void;
}) {
  const { changing, run: transitionSection, finish: finishSection } = useSectionTransition(active);
  const requestRef = useRef(0);
  const playRequestRef = useRef(0);
  const loadingRef = useRef(false);
  const busyRef = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const pageIndexRef = useRef(0);
  const sectionRef = useRef<UserSection>('playlists');
  const listsRef = useRef<UserPlaylist[]>([]);
  const tracksRef = useRef<PersonalTrack[]>([]);
  const refreshRef = useRef<() => Promise<boolean>>(async () => false);
  const beforeRefreshRef = useRef<() => void>(() => {});
  const [section, setSectionState] = useState<UserSection>('playlists');
  const [selectedId, setSelectedIdState] = useState<number | null>(null);
  const [pageIndex, setPageIndexState] = useState(0);
  const [lists, setListsState] = useState<UserPlaylist[]>([]);
  const [tracks, setTracksState] = useState<PersonalTrack[]>([]);
  const [loading, setLoadingState] = useState(false);
  const [busy, setBusyState] = useState(false);
  const [feedback, setFeedback] = useState({ message: '正在读取个人音乐数据…', error: false });

  function setSection(value: UserSection) {
    sectionRef.current = value;
    setSectionState(value);
  }
  function setSelectedId(value: number | null) {
    selectedIdRef.current = value;
    setSelectedIdState(value);
  }
  function setPageIndex(value: number) {
    pageIndexRef.current = value;
    setPageIndexState(value);
  }
  function setLists(value: UserPlaylist[]) {
    listsRef.current = value;
    setListsState(value);
  }
  function setTracks(value: PersonalTrack[]) {
    tracksRef.current = value;
    setTracksState(value);
  }
  function setLoading(value: boolean) {
    loadingRef.current = value;
    setLoadingState(value);
  }
  function setBusy(value: boolean) {
    busyRef.current = value;
    setBusyState(value);
  }

  function notice(message: string, error = false) {
    if (!unmountedRef.current) setFeedback({ message, error });
  }

  async function refresh(): Promise<boolean> {
    if (unmountedRef.current) return false;
    if (sectionRef.current === 'admin') {
      setLoading(false);
      finishSection();
      return true;
    }
    const current = ++requestRef.current;
    // 重新读取数据时让更早的播放反馈失效，避免旧错误覆盖新的同步结果。
    playRequestRef.current += 1;
    // 头像上传成功会推进版本号，较早发出的 profile 响应不能把新头像覆盖回旧值。
    const profileRevision = profile.revisionRef.current;
    beforeRefreshRef.current();
    setLoading(true);
    notice('正在读取个人音乐数据…');
    try {
      const nextProfile = await api.profile();
      if (unmountedRef.current || current !== requestRef.current) return false;
      if (profile.profileRef.current && profile.profileRef.current.id !== nextProfile.id) {
        listsRef.current = [];
        setListsState([]);
        tracksRef.current = [];
        setTracksState([]);
        selectedIdRef.current = null;
        setSelectedIdState(null);
        pageIndexRef.current = 0;
        setPageIndexState(0);
      }
      profile.acceptProfile(nextProfile, profileRevision);
      if (sectionRef.current === 'playlists') {
        const nextLists = await api.playlists();
        const detail = selectedIdRef.current ? await api.playlist(selectedIdRef.current) : null;
        if (unmountedRef.current || current !== requestRef.current) return false;
        setLists(nextLists);
        setTracks(detail?.tracks || []);
      } else if (sectionRef.current === 'favorites') {
        let favoritePage = pageIndexRef.current;
        let nextTracks = await api.likes(favoritePage * 5);
        if (unmountedRef.current || current !== requestRef.current) return false;
        // 喜爱每页 5 首、接口多取 1 首探测下一页；取消最后一首后回退，避免停在空页。
        while (favoritePage > 0 && nextTracks.length === 0) {
          favoritePage -= 1;
          nextTracks = await api.likes(favoritePage * 5);
          if (unmountedRef.current || current !== requestRef.current) return false;
        }
        if (favoritePage !== pageIndexRef.current) setPageIndex(favoritePage);
        setTracks(nextTracks);
      } else if (sectionRef.current === 'uploads') {
        const nextTracks = await api.uploads(nextProfile.id);
        if (unmountedRef.current || current !== requestRef.current) return false;
        setTracks(nextTracks);
      }
      notice('个人数据已同步 · 重新登录后仍会保留');
      return true;
    } catch (error) {
      if (current === requestRef.current && !unmountedRef.current) {
        if (error instanceof PersonalLibraryError && error.status === 401) {
          listsRef.current = [];
          setListsState([]);
          tracksRef.current = [];
          setTracksState([]);
          selectedIdRef.current = null;
          setSelectedIdState(null);
          pageIndexRef.current = 0;
          setPageIndexState(0);
          profile.clearProfile();
        }
        notice(error instanceof Error ? error.message : '读取失败，请重试', true);
      }
      return false;
    } finally {
      if (!unmountedRef.current && current === requestRef.current) {
        setLoading(false);
        // 以最新请求为准；切换途中触发的外部刷新也能正确结束淡出。
        finishSection();
      }
    }
  }
  refreshRef.current = refresh;

  async function mutate(action: () => Promise<unknown>, message: string) {
    if (busyRef.current || unmountedRef.current) return;
    setBusy(true);
    try {
      await action();
      if (unmountedRef.current) return;
      if (await refreshRef.current()) notice(message);
      changed?.();
    } catch (error) {
      notice(error instanceof Error ? error.message : '保存失败，请重试', true);
    } finally {
      if (!unmountedRef.current) setBusy(false);
    }
  }

  function changeSection(next: UserSection) {
    // 淡出时保留旧视图，避免先换成空列表再淡出的闪烁。
    requestRef.current += 1;
    playRequestRef.current += 1;
    transitionSection(() => {
      if (unmountedRef.current) return;
      setSection(next);
      setSelectedId(null);
      setPageIndex(0);
      setTracks([]);
      void refreshRef.current();
    });
  }

  function changePlaylist(id: number | null) {
    if (busyRef.current || loadingRef.current) return;
    beforeRefreshRef.current();
    requestRef.current += 1;
    playRequestRef.current += 1;
    // 与分类切换共用过渡：旧内容淡出后再换视图，由最新数据请求触发淡入。
    transitionSection(() => {
      if (unmountedRef.current) return;
      setSelectedId(id);
      setPageIndex(0);
      setTracks([]);
      void refreshRef.current();
    });
  }

  function openPlaylist(id: number) {
    changePlaylist(id);
  }
  function backToPlaylists() {
    changePlaylist(null);
  }

  function onStep(step: number) {
    if (busyRef.current || loadingRef.current) return;
    setPageIndex(pageIndexRef.current + step);
    if (sectionRef.current === 'favorites') void refreshRef.current();
  }

  useEffect(
    () => () => {
      requestRef.current += 1;
      playRequestRef.current += 1;
    },
    [],
  );
  useEffect(() => {
    // 首次 active 由 App 懒挂载，重新进入用户页时刷新数据。
    if (active) void refreshRef.current();
  }, [active]);

  return {
    section,
    selectedId,
    pageIndex,
    lists,
    tracks,
    loading,
    busy,
    feedback,
    changing,
    busyRef,
    loadingRef,
    listsRef,
    tracksRef,
    playRequestRef,
    refreshRef,
    beforeRefreshRef,
    setSection,
    setSelectedId,
    setPageIndex,
    setBusy,
    notice,
    mutate,
    changeSection,
    openPlaylist,
    backToPlaylists,
    onStep,
  };
}
