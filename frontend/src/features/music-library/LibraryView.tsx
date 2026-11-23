import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MusicActions, SearchItem } from '../../shared/music.ts';
import { randomArchiveJump, type ArchiveNavigation } from '../../rhine/archive-loop.ts';
import { ARCHIVE_START_ROW, archiveLayout, createArchiveLayout } from '../../rhine/data.ts';
import type { mountArchiveScene } from '../../graphics/archive/scene-host.ts';
import { albumTrack } from './tracks.ts';
import { demoAlbums, fetchAlbumTracks, type DemoAlbum } from './album-data.ts';
import type { LibraryAlbum, PersonalAlbum } from './personal-albums.ts';
import { AlbumDetail, AlbumInformation, type DetailTrackState } from './album-views.tsx';
import type { SearchAlbumSelection } from './search-album.ts';
import { ArchiveSwitcher } from './ArchiveSwitcher.tsx';

export interface LibraryViewProps {
  scene: ReturnType<typeof mountArchiveScene> | null;
  actions: MusicActions;
  onPlayAlbum?(tracks: SearchItem[]): Promise<void>;
  onSelected(album: DemoAlbum): void;
  onModeChanged(mode: 'archive' | 'detail'): void;
  active: boolean;
  initialIndex?: number;
  personalAlbums?: readonly PersonalAlbum[];
  searchAlbum?: SearchAlbumSelection;
  recentPlaybackRevision?: number;
  loadPersonalTracks?(album: PersonalAlbum, signal: AbortSignal): Promise<PersonalAlbum>;
}

export interface LibraryViewHandle {
  readonly selectedAlbum: LibraryAlbum;
  readonly mode: 'archive' | 'detail';
  selectRecord(index: number, navigation?: ArchiveNavigation): void;
  navigate(axis: 'row' | 'lane', direction: number): void;
  openDetail(): void;
  closeDetail(): void;
  resetDetail(): void;
  afterUpdate(visibility: number, now: number): boolean;
  cancelSearchJump(): void;
}

// 呼出层只渲染资料、歌单刻度与详情文案；三维画布和档案场景仍由上层 App 持有。
export const LibraryView = forwardRef<LibraryViewHandle, LibraryViewProps>(
  function LibraryView(props, ref) {
    const { scene, actions, active } = props;
    const initialAlbum = demoAlbums[props.initialIndex ?? 0] ?? demoAlbums[0];
    const searchAlbum = props.searchAlbum;
    const hasSearchAlbum = Boolean(searchAlbum);
    const personalCount = props.personalAlbums?.length ?? 0;
    const albums = useMemo(
      () => [
        ...demoAlbums,
        ...(props.personalAlbums ?? []),
        ...(searchAlbum ? [searchAlbum.album] : []),
      ],
      [props.personalAlbums, searchAlbum],
    );
    const layout = useMemo(
      () =>
        personalCount || hasSearchAlbum
          ? createArchiveLayout(personalCount, hasSearchAlbum)
          : archiveLayout,
      [personalCount, hasSearchAlbum],
    );
    const catalog = useRef({ albums, layout });
    const [informationVisible, setInformationVisible] = useState(false);
    const [selectedId, setSelectedId] = useState(initialAlbum.id);
    const [mode, setModeState] = useState<'archive' | 'detail'>('archive');
    const [detailData, setDetailData] = useState<LibraryAlbum | null>(null);
    const [detailTrackState, setDetailTrackState] = useState<DetailTrackState>('ready');
    const [detailHidden, setDetailHiddenState] = useState(true);
    const [detailInert, setDetailInertState] = useState(true);

    const selectedAlbum = useRef<LibraryAlbum>(initialAlbum);
    const recordIndexRef = useRef(
      archiveLayout.records.findIndex((record) => demoAlbums[record.albumIndex] === initialAlbum),
    );
    const modeRef = useRef<'archive' | 'detail'>('archive');
    const sceneRef = useRef(scene);
    sceneRef.current = scene;
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const onSelectedRef = useRef(props.onSelected);
    onSelectedRef.current = props.onSelected;
    const onModeChangedRef = useRef(props.onModeChanged);
    onModeChangedRef.current = props.onModeChanged;
    const loadPersonalTracks = useRef(props.loadPersonalTracks);
    loadPersonalTracks.current = props.loadPersonalTracks;
    const detailAlbum = useRef(detailData);
    detailAlbum.current = detailData;
    const detailRef = useRef<HTMLElement | null>(null);
    const detailHiddenRef = useRef(true);
    const detailIdleSinceRef = useRef(0);
    const albumControllerRef = useRef<AbortController | null>(null);
    const loadedAlbumsRef = useRef(new Map<string, DemoAlbum>());
    const disposedRef = useRef(false);
    const requestedJump = useRef(searchAlbum);
    const consumedJump = useRef<SearchAlbumSelection | undefined>(undefined);
    const pendingJump = useRef(false);
    requestedJump.current = searchAlbum;
    const cancelSearchJump = useCallback(() => {
      pendingJump.current = false;
      consumedJump.current = requestedJump.current;
    }, []);

    useEffect(() => {
      disposedRef.current = false;
      if (!selectedAlbum.current.personal && !selectedAlbum.current.searchSource)
        onSelectedRef.current(selectedAlbum.current);
      return () => {
        disposedRef.current = true;
        albumControllerRef.current?.abort();
      };
    }, []);

    const setArchiveMode = useCallback((next: 'archive' | 'detail') => {
      const archive = detailRef.current?.closest<HTMLElement>('[data-album-archive]');
      if (archive) archive.dataset.mode = next;
    }, []);

    const setDetailHidden = useCallback((hidden: boolean) => {
      detailHiddenRef.current = hidden;
      if (detailRef.current) detailRef.current.hidden = hidden;
      setDetailHiddenState(hidden);
    }, []);

    const setDetailInert = useCallback((inert: boolean) => {
      if (detailRef.current) detailRef.current.inert = inert;
      setDetailInertState(inert);
    }, []);

    const selectRecord = useCallback(
      (nextRecord: number, navigation?: ArchiveNavigation) => {
        const currentScene = sceneRef.current;
        if (!currentScene?.ready && currentScene?.entryPhase !== 'failed') return;
        const { albums, layout } = catalog.current;
        const record = layout.records[nextRecord];
        if (!record) return;
        cancelSearchJump();
        recordIndexRef.current = nextRecord;
        const album = albums[record.albumIndex];
        selectedAlbum.current = album;
        setSelectedId(album.id);
        if (navigation && 'cell' in navigation) setInformationVisible(true);
        if (!album.personal && !album.searchSource) onSelectedRef.current(album);
        currentScene?.select(nextRecord, navigation);
      },
      [cancelSearchJump],
    );

    const navigate = useCallback(
      (axis: 'row' | 'lane', direction: number) => {
        const { locations, columns } = catalog.current.layout;
        const current = locations[recordIndexRef.current];
        const lane =
          axis === 'lane'
            ? (current.lane + direction + columns.length) % columns.length
            : current.lane;
        const files = columns[lane];
        if (!files.length) return;
        const row =
          (current.row - ARCHIVE_START_ROW + (axis === 'row' ? direction : 0) + files.length) %
          files.length;
        selectRecord(files[row], { axis, direction });
      },
      [selectRecord],
    );

    const requestDetailTracks = useCallback((album: DemoAlbum | PersonalAlbum, refresh = false) => {
      albumControllerRef.current?.abort();
      const controller = new AbortController();
      albumControllerRef.current = controller;
      const load = album.personal
        ? (loadPersonalTracks.current?.(album, controller.signal) ?? Promise.resolve(album))
        : fetchAlbumTracks(album.id, undefined, controller.signal).then((tracks) => ({
            ...album,
            tracks,
            totalTracks: tracks.length,
          }));
      void load
        .then((complete) => {
          if (
            disposedRef.current ||
            controller.signal.aborted ||
            modeRef.current !== 'detail' ||
            selectedAlbum.current.id !== album.id
          )
            return;
          if (!complete.personal) loadedAlbumsRef.current.set(album.id, complete);
          const current = selectedAlbum.current;
          setDetailData(
            complete.personal && current.personal
              ? { ...complete, coverUrl: current.coverUrl }
              : complete,
          );
          setDetailTrackState('ready');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (
            !disposedRef.current &&
            modeRef.current === 'detail' &&
            selectedAlbum.current.id === album.id
          ) {
            setDetailTrackState((state) => (refresh && state === 'ready' ? state : 'unavailable'));
          }
        });
    }, []);

    useEffect(() => {
      if (!props.recentPlaybackRevision || modeRef.current !== 'detail') return;
      const album = selectedAlbum.current;
      if (album.personal === 'recent') requestDetailTracks(album, true);
    }, [props.recentPlaybackRevision, requestDetailTracks]);

    const openDetail = useCallback(() => {
      const currentScene = sceneRef.current;
      if (
        modeRef.current !== 'archive' ||
        (!currentScene?.ready && currentScene?.entryPhase !== 'failed')
      )
        return;
      cancelSearchJump();
      modeRef.current = 'detail';
      setModeState('detail');
      onModeChangedRef.current('detail');
      detailIdleSinceRef.current = 0;

      const album = selectedAlbum.current;
      const cached = album.searchSource
        ? album
        : album.personal
          ? undefined
          : loadedAlbumsRef.current.get(album.id);
      setDetailData(cached ?? album);
      setDetailTrackState(cached ? 'ready' : 'loading');
      setDetailHidden(false);
      setDetailInert(false);
      setArchiveMode('detail');
      const element = detailRef.current;
      if (element) {
        element.style.setProperty('--detail-visibility', '0');
        element.style.setProperty('--detail-offset', '18px');
      }
      currentScene?.setMode('detail');
      currentScene?.wake();

      if (!cached && !album.searchSource) requestDetailTracks(album);
    }, [cancelSearchJump, requestDetailTracks, setArchiveMode, setDetailHidden, setDetailInert]);

    const closeDetail = useCallback(() => {
      if (modeRef.current !== 'detail') return;
      modeRef.current = 'archive';
      setModeState('archive');
      onModeChangedRef.current('archive');
      albumControllerRef.current?.abort();
      albumControllerRef.current = null;
      detailIdleSinceRef.current = 0;
      setDetailInert(true);
      sceneRef.current?.setMode('archive');
      sceneRef.current?.wake();
      if (sceneRef.current?.entryPhase === 'failed') {
        setDetailHidden(true);
        setArchiveMode('archive');
      }
    }, [setArchiveMode, setDetailHidden, setDetailInert]);

    const resetDetail = useCallback(() => {
      cancelSearchJump();
      if (modeRef.current !== 'detail') return;
      modeRef.current = 'archive';
      setModeState('archive');
      onModeChangedRef.current('archive');
      albumControllerRef.current?.abort();
      albumControllerRef.current = null;
      detailIdleSinceRef.current = 0;
      setDetailHidden(true);
      setDetailInert(true);
      setArchiveMode('archive');
      sceneRef.current?.setMode('archive');
    }, [cancelSearchJump, setArchiveMode, setDetailHidden, setDetailInert]);

    useLayoutEffect(() => {
      catalog.current = { albums, layout };
      const index = albums.findIndex((album) => album.id === selectedAlbum.current.id);
      const next = albums[index] ?? albums[0];
      if (index < 0) {
        resetDetail();
        setSelectedId(next.id);
        if (!next.personal && !next.searchSource) onSelectedRef.current(next);
      }
      selectedAlbum.current = next;
      recordIndexRef.current = layout.records.findIndex(
        (record) => record.albumIndex === Math.max(index, 0),
      );
      scene?.setCatalog?.(
        layout,
        albums.map((album) => album.coverUrl),
        recordIndexRef.current,
      );
      if (next.personal && modeRef.current === 'detail') {
        setDetailData((current) =>
          current?.personal && current.id === next.id
            ? { ...current, coverUrl: next.coverUrl }
            : current,
        );
      }
    }, [albums, layout, resetDetail, scene]);

    useLayoutEffect(() => {
      if (!searchAlbum || searchAlbum === consumedJump.current || !active) return;
      if (!scene?.ready && scene?.entryPhase !== 'failed') return;
      resetDetail();
      selectRecord(layout.records.length - 1, randomArchiveJump());
      if (scene.entryPhase === 'failed') openDetail();
      else pendingJump.current = true;
    }, [active, layout, openDetail, resetDetail, scene, searchAlbum, selectRecord]);

    const afterUpdate = useCallback(
      (visibility: number, now: number) => {
        const element = detailRef.current;
        if (!element || disposedRef.current) return true;
        if (pendingJump.current && sceneRef.current?.selectionSettled) {
          openDetail();
          return true;
        }
        if (modeRef.current === 'detail' || !element.hidden) {
          // 细粒度视觉值直接写 CSS 变量，不随每一帧触发 React render。
          element.style.setProperty('--detail-visibility', String(visibility));
          element.style.setProperty('--detail-offset', `${(1 - visibility) * 18}px`);
          if (modeRef.current === 'detail') {
            if (visibility > 0.995) {
              if (!detailIdleSinceRef.current) detailIdleSinceRef.current = now;
              if (now - detailIdleSinceRef.current > 1400) return false;
            } else detailIdleSinceRef.current = 0;
          } else if (visibility < 0.01) {
            element.hidden = true;
            setArchiveMode('archive');
            if (!detailHiddenRef.current) setDetailHidden(true);
          }
        }
        return true;
      },
      [openDetail, setArchiveMode, setDetailHidden],
    );

    // 打开详情时把细粒度过渡变量归零；后续帧只由 afterUpdate 写入。
    useLayoutEffect(() => {
      if (mode !== 'detail') return;
      const element = detailRef.current;
      if (!element) return;
      const failed = sceneRef.current?.entryPhase === 'failed';
      element.style.setProperty('--detail-visibility', failed ? '1' : '0');
      element.style.setProperty('--detail-offset', failed ? '0px' : '18px');
    }, [mode]);

    const resolveDetailTrack = useCallback((trackId: string): SearchItem | null => {
      const album = detailAlbum.current;
      if (!album) return null;
      const index = album.tracks.findIndex((track) => track.id === trackId);
      const track = album.tracks[index];
      return track && (!('playable' in track) || track.playable) ? albumTrack(album, index) : null;
    }, []);

    const playDetailTrack = useCallback(
      (trackId: string) => {
        const track = resolveDetailTrack(trackId);
        if (track) void actionsRef.current.play(track).catch(() => undefined);
      },
      [resolveDetailTrack],
    );

    const enqueueDetailTrack = useCallback(
      (trackId: string) => {
        const track = resolveDetailTrack(trackId);
        if (track) actionsRef.current.enqueue(track);
      },
      [resolveDetailTrack],
    );

    useImperativeHandle(
      ref,
      () => ({
        get selectedAlbum() {
          return selectedAlbum.current;
        },
        get mode() {
          return modeRef.current;
        },
        selectRecord,
        navigate,
        openDetail,
        closeDetail,
        resetDetail,
        afterUpdate,
        cancelSearchJump,
      }),
      [afterUpdate, cancelSearchJump, closeDetail, navigate, openDetail, resetDetail, selectRecord],
    );

    const selectedIndex = Math.max(
      0,
      albums.findIndex((album) => album.id === selectedId),
    );
    const album = albums[selectedIndex];
    const record = layout.records.findIndex((item) => item.albumIndex === selectedIndex);
    return (
      <>
        <ArchiveSwitcher
          active={active}
          albumCount={albums.length}
          albumIndex={selectedIndex}
          layout={layout}
          selectedRecord={record}
          navigate={navigate}
          selectRecord={selectRecord}
        />
        <AlbumInformation
          album={album}
          index={selectedIndex}
          visible={informationVisible && active}
          active={active}
          onOpen={openDetail}
        />
        <section
          ref={detailRef}
          className="album-detail"
          data-album-detail
          hidden={detailHidden}
          inert={detailInert ? true : undefined}
          aria-hidden={detailInert ? 'true' : 'false'}
        >
          {detailData && (
            <>
              <AlbumDetail
                album={detailData}
                trackState={detailTrackState}
                highlightTrackId={
                  detailData.searchSource && !detailInert ? searchAlbum?.trackId : undefined
                }
                onClose={closeDetail}
                onPlay={playDetailTrack}
                onEnqueue={enqueueDetailTrack}
                onPlayAll={props.onPlayAlbum}
              />
            </>
          )}
        </section>
      </>
    );
  },
);

export default LibraryView;

export { AlbumDetail, AlbumInformation } from './album-views.tsx';
