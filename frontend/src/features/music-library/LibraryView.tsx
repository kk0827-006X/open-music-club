import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
} from 'react'
import type { SyntheticEvent } from 'react'
import type { MusicActions, SearchItem } from '../../shared/music.ts'
import type { ArchiveNavigation } from '../../rhine/archive-loop.ts'
import { archiveColumns, columnFiles, fileLocation, records } from '../../rhine/data.ts'
import type { mountArchiveScene } from '../../graphics/archive/scene-host.ts'
import { Icon } from '../../shared/react/ui.tsx'
import { albumTrack } from './tracks.ts'
import { demoAlbums, fetchAlbumTracks, type DemoAlbum } from './album-data.ts'

const FALLBACK_COVER = '/images/album-placeholder-01.svg'
const TICKS_PER_SHELF = 8

function replaceBrokenCover(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (!image.src.endsWith('album-placeholder-01.svg')) image.src = FALLBACK_COVER
}

function durationOf(album: DemoAlbum) {
  const seconds = album.tracks.reduce((total, track) => {
    const [minutes, remainder] = track.duration.split(':').map(Number)
    return total + (Number.isFinite(minutes) ? minutes : 0) * 60 + (Number.isFinite(remainder) ? remainder : 0)
  }, 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export interface LibraryViewProps {
  scene: ReturnType<typeof mountArchiveScene> | null
  actions: MusicActions
  onSelected(album: DemoAlbum): void
  onModeChanged(mode: 'archive' | 'detail'): void
  active: boolean
  initialIndex?: number
}

export interface LibraryViewHandle {
  readonly selectedAlbum: DemoAlbum
  readonly mode: 'archive' | 'detail'
  selectRecord(
    index: number,
    navigation?: { axis: 'row' | 'lane'; direction: number } | { cell: { lane: number; row: number } },
  ): void
  navigate(axis: 'row' | 'lane', direction: number): void
  openDetail(): void
  closeDetail(): void
  resetDetail(): void
  afterUpdate(visibility: number, now: number): boolean
}

type DetailTrackState = 'ready' | 'loading' | 'unavailable'

// 呼出层只渲染资料、歌单刻度与详情文案；三维画布和档案场景仍由上层 App 持有。
export const LibraryView = forwardRef<LibraryViewHandle, LibraryViewProps>(function LibraryView(props, ref) {
  const { scene, actions, active } = props
  const [selectedIndex, setSelectedIndex] = useState(props.initialIndex ?? 0)
  const [mode, setModeState] = useState<'archive' | 'detail'>('archive')
  const [detailData, setDetailData] = useState<DemoAlbum | null>(null)
  const [detailTrackState, setDetailTrackState] = useState<DetailTrackState>('ready')
  const [detailHidden, setDetailHiddenState] = useState(true)
  const [detailInert, setDetailInertState] = useState(true)

  const selectedIndexRef = useRef(props.initialIndex ?? 0)
  const recordIndexRef = useRef(records.findIndex(record => record.albumIndex === (props.initialIndex ?? 0)))
  const modeRef = useRef<'archive' | 'detail'>('archive')
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const onSelectedRef = useRef(props.onSelected)
  onSelectedRef.current = props.onSelected
  const onModeChangedRef = useRef(props.onModeChanged)
  onModeChangedRef.current = props.onModeChanged
  const detailRef = useRef<HTMLElement | null>(null)
  const detailHiddenRef = useRef(true)
  const detailIdleSinceRef = useRef(0)
  const albumControllerRef = useRef<AbortController | null>(null)
  const loadedAlbumsRef = useRef(new Map<string, DemoAlbum>())
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    onSelectedRef.current(demoAlbums[selectedIndexRef.current])
    return () => { disposedRef.current = true }
  }, [])

  // 关闭动画期间不隐藏详情，等场景 visibility 降到 0.01 以下时再收起，和原行为一致。
  useEffect(() => () => {
    albumControllerRef.current?.abort()
  }, [])

  const setArchiveMode = useCallback((next: 'archive' | 'detail') => {
    const archive = detailRef.current?.closest<HTMLElement>('[data-album-archive]')
    if (archive) archive.dataset.mode = next
  }, [])

  const setDetailHidden = useCallback((hidden: boolean) => {
    detailHiddenRef.current = hidden
    if (detailRef.current) detailRef.current.hidden = hidden
    setDetailHiddenState(hidden)
  }, [])

  const setDetailInert = useCallback((inert: boolean) => {
    if (detailRef.current) detailRef.current.inert = inert
    setDetailInertState(inert)
  }, [])

  const selectRecord = useCallback((
    nextRecord: number,
    navigation?: { axis: 'row' | 'lane'; direction: number } | { cell: { lane: number; row: number } },
  ) => {
    const currentScene = sceneRef.current
    if (!currentScene?.ready) return
    const record = records[nextRecord]
    if (!record) return
    recordIndexRef.current = nextRecord
    const nextIndex = record.albumIndex
    selectedIndexRef.current = nextIndex
    setSelectedIndex(nextIndex)
    onSelectedRef.current(demoAlbums[nextIndex])
    currentScene.select(nextRecord, navigation as ArchiveNavigation | undefined)
  }, [])

  const navigate = useCallback((axis: 'row' | 'lane', direction: number) => {
    const current = fileLocation(recordIndexRef.current)
    const lane = axis === 'lane'
      ? (current.lane + direction + archiveColumns.length) % archiveColumns.length
      : current.lane
    const files = columnFiles(lane)
    if (!files.length) return
    const row = (current.row - 12 + (axis === 'row' ? direction : 0) + files.length) % files.length
    selectRecord(files[row], { axis, direction })
  }, [selectRecord])

  const openDetail = useCallback(() => {
    const currentScene = sceneRef.current
    if (modeRef.current !== 'archive' || !currentScene?.ready) return
    modeRef.current = 'detail'
    setModeState('detail')
    onModeChangedRef.current('detail')
    detailIdleSinceRef.current = 0

    const album = demoAlbums[selectedIndexRef.current]
    const cached = loadedAlbumsRef.current.get(album.id)
    setDetailData(cached ?? album)
    setDetailTrackState(cached ? 'ready' : 'loading')
    setDetailHidden(false)
    setDetailInert(false)
    setArchiveMode('detail')
    const element = detailRef.current
    if (element) {
      element.style.setProperty('--detail-visibility', '0')
      element.style.setProperty('--detail-offset', '18px')
    }
    currentScene.setMode('detail')
    currentScene.wake()

    albumControllerRef.current?.abort()
    if (cached) {
      albumControllerRef.current = null
      return
    }
    const controller = new AbortController()
    albumControllerRef.current = controller
    void fetchAlbumTracks(album.id, undefined, controller.signal).then((tracks) => {
      if (disposedRef.current || controller.signal.aborted || modeRef.current !== 'detail'
        || demoAlbums[selectedIndexRef.current].id !== album.id) return
      const complete = { ...album, tracks, totalTracks: tracks.length }
      loadedAlbumsRef.current.set(album.id, complete)
      setDetailData(complete)
      setDetailTrackState('ready')
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!disposedRef.current && modeRef.current === 'detail'
        && demoAlbums[selectedIndexRef.current].id === album.id) {
        setDetailTrackState('unavailable')
      }
    })
  }, [setArchiveMode, setDetailHidden, setDetailInert])

  const closeDetail = useCallback(() => {
    if (modeRef.current !== 'detail') return
    modeRef.current = 'archive'
    setModeState('archive')
    onModeChangedRef.current('archive')
    albumControllerRef.current?.abort()
    albumControllerRef.current = null
    detailIdleSinceRef.current = 0
    setDetailInert(true)
    sceneRef.current?.setMode('archive')
    sceneRef.current?.wake()
  }, [setDetailInert])

  const resetDetail = useCallback(() => {
    if (modeRef.current !== 'detail') return
    modeRef.current = 'archive'
    setModeState('archive')
    onModeChangedRef.current('archive')
    albumControllerRef.current?.abort()
    albumControllerRef.current = null
    detailIdleSinceRef.current = 0
    setDetailHidden(true)
    setDetailInert(true)
    setArchiveMode('archive')
    sceneRef.current?.setMode('archive')
  }, [setArchiveMode, setDetailHidden, setDetailInert])

  const afterUpdate = useCallback((visibility: number, now: number) => {
    const element = detailRef.current
    if (!element || disposedRef.current) return true
    if (modeRef.current === 'detail' || !element.hidden) {
      // 细粒度视觉值直接写 CSS 变量，不随每一帧触发 React render。
      element.style.setProperty('--detail-visibility', String(visibility))
      element.style.setProperty('--detail-offset', `${(1 - visibility) * 18}px`)
      if (modeRef.current === 'detail') {
        if (visibility > .995) {
          if (!detailIdleSinceRef.current) detailIdleSinceRef.current = now
          if (now - detailIdleSinceRef.current > 1400) return false
        } else detailIdleSinceRef.current = 0
      } else if (visibility < .01) {
        element.hidden = true
        setArchiveMode('archive')
        if (!detailHiddenRef.current) setDetailHidden(true)
      }
    }
    return true
  }, [setArchiveMode, setDetailHidden])

  // 打开详情时把细粒度过渡变量归零；后续帧只由 afterUpdate 写入。
  useLayoutEffect(() => {
    if (mode !== 'detail') return
    const element = detailRef.current
    if (!element) return
    element.style.setProperty('--detail-visibility', '0')
    element.style.setProperty('--detail-offset', '18px')
  }, [mode])

  const resolveDetailTrack = useCallback((trackId: string): SearchItem | null => {
    const album = loadedAlbumsRef.current.get(demoAlbums[selectedIndexRef.current].id)
      ?? demoAlbums[selectedIndexRef.current]
    const index = album.tracks.findIndex((track) => track.id === trackId)
    return index >= 0 ? albumTrack(album, index) : null
  }, [])

  const playDetailTrack = useCallback((trackId: string) => {
    const track = resolveDetailTrack(trackId)
    if (track) void actionsRef.current.play(track).catch(() => undefined)
  }, [resolveDetailTrack])

  const enqueueDetailTrack = useCallback((trackId: string) => {
    const track = resolveDetailTrack(trackId)
    if (track) actionsRef.current.enqueue(track)
  }, [resolveDetailTrack])

  useImperativeHandle(ref, () => ({
    get selectedAlbum() { return demoAlbums[selectedIndexRef.current] },
    get mode() { return modeRef.current },
    selectRecord,
    navigate,
    openDetail,
    closeDetail,
    resetDetail,
    afterUpdate,
  }), [afterUpdate, closeDetail, navigate, openDetail, resetDetail, selectRecord])

  const album = demoAlbums[selectedIndex]


  return (
    <>
      <aside className="archive-callout">
        <p>ALBUM / SELECT</p>
        <strong data-album-counter>{String(selectedIndex + 1).padStart(2, '0')}</strong>
        <span>/ {demoAlbums.length}</span>
      </aside>
      <div
        className="archive-switcher"
        aria-label="当前排专辑位置"
        inert={active ? undefined : true}
      >
        <button type="button" data-album-previous aria-label="上一张专辑" onClick={() => navigate('row', -1)}>
          <Icon name="up" />
        </button>
        <div className="archive-position-ticks">
          {Array.from({ length: TICKS_PER_SHELF }, (_, index) => (
            <button
              key={index}
              type="button"
              data-album-tick={index}
              aria-label={`当前排第 ${index + 1} 张专辑`}
              aria-current={index === selectedIndex % TICKS_PER_SHELF ? 'true' : undefined}
              onClick={() => {
                const lane = fileLocation(recordIndexRef.current).lane
                selectRecord(columnFiles(lane)[index], { axis: 'row', direction: 1 })
              }}
            />
          ))}
        </div>
        <button type="button" data-album-next aria-label="下一张专辑" onClick={() => navigate('row', 1)}>
          <Icon name="down" />
        </button>
      </div>
      <AlbumInformation album={album} index={selectedIndex} active={active} onOpen={openDetail} />
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
<AlbumDetail album={detailData} trackState={detailTrackState} onClose={closeDetail} onPlay={playDetailTrack} onEnqueue={enqueueDetailTrack} />
          </>
        )}
      </section>
    </>
  )
})

export default LibraryView

export function AlbumInformation({ album, index, active = true, onOpen = () => undefined }: { album: DemoAlbum; index: number; active?: boolean; onOpen?: () => void }) {
  return (      <aside
        className="archive-selection-copy"
        data-album-information
        aria-live="polite"
        inert={active ? undefined : true}
      >
        <p>ALBUM {String(index + 1).padStart(3, '0')}</p>
        <h2>{album.title}</h2>
        <h3>{album.artist}</h3>
        <span>{album.artist}</span>
        <dl>
          <div><dt>RELEASE / 发行年份</dt><dd>{album.year}</dd></div>
          <div><dt>ARTIST / 艺术家</dt><dd>{album.artist}</dd></div>
          <div><dt>GENRE / 流派</dt><dd>{album.genre}</dd></div>
          <div><dt>SOURCE / 来源</dt><dd><b><i />NETEASE</b></dd></div>
          <div><dt>TRACKS / 曲目数量</dt><dd>{album.totalTracks} 首</dd></div>
          <div><dt>FORMAT / 播放形式</dt><dd>在线音源</dd></div>
          <div><dt>PREVIEW / 代表曲目</dt><dd>{durationOf(album)}</dd></div>
          <div><dt>CATALOG / 目录</dt><dd>网易云音乐</dd></div>
        </dl>
        <button type="button" data-open-selected onClick={onOpen}>
          打开专辑 <span><Icon name="open" /></span>
        </button>
      </aside>)
}

export function AlbumDetail({ album, trackState = 'ready', onClose = () => undefined, onPlay = () => undefined, onEnqueue = () => undefined }: {
  album: DemoAlbum; trackState?: DetailTrackState; onClose?: () => void; onPlay?: (id: string) => void; onEnqueue?: (id: string) => void
}) {
  const trackHeading = trackState === 'loading'
    ? '正在获取专辑全部曲目…'
    : trackState === 'unavailable'
      ? '完整曲目暂时不可用 · 以下为代表曲目'
      : '专辑曲目'
  return (<>            <button className="detail-back" type="button" data-back-to-archive onClick={onClose}>
              <Icon name="left" />&nbsp;&nbsp;返回专辑架 <kbd>ESC</kbd>
            </button>
            <section className="detail-cover-frame">
              <div className="detail-cover">
                <img
                  src={album.coverUrl}
                  alt={`${album.title} 封面`}
                  onError={replaceBrokenCover}
                />
              </div>
              <p>ALBUM / {album.id}</p>
              <small>网易云音乐 · 真实专辑封面</small>
            </section>
            <article className="detail-information" data-detail-information>
              <p>ALBUM DETAIL&nbsp;&nbsp;/&nbsp;&nbsp;MUSIC ARCHIVE</p>
              <h2>{album.title}</h2>
              <h3>{album.artist}</h3>
              <div className="detail-facts">
                <p><small>RELEASE / 发行年份</small>{album.year}</p>
                <p><small>ARTIST / 艺术家</small>{album.artist}</p>
                <p><small>GENRE / 流派</small>{album.genre}</p>
                <p><small>SOURCE / 来源</small>NETEASE</p>
              </div>
              <p className="detail-description">{album.description}</p>
              <section className="detail-track-preview" aria-live="polite">
                <header>
                  <b>01&nbsp;&nbsp;{trackHeading}</b>
                  <span>专辑共 {album.totalTracks} 首</span>
                </header>
                <ol>
                  {trackState !== 'loading' && album.tracks.map((track, index) => (
                    <li key={`${track.id}-${index}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{track.title}</strong>
                      <small>NETEASE</small>
                      <time>{track.duration}</time>
                      <button type="button" data-album-play={track.id} onClick={() => onPlay(track.id)}>
                        <Icon name="play" /> 播放
                      </button>
                      <button type="button" data-album-queue={track.id} onClick={() => onEnqueue(track.id)}>
                        <Icon name="plus" /> 队列
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            </article></>)
}
