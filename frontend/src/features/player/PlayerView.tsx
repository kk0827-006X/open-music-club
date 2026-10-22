import {
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type {
  FormEvent, MouseEvent as ReactMouseEvent, RefObject, SyntheticEvent,
} from 'react'
import { createPersonalLibraryClient, toPersonalSong } from '../../services/music/personal-library.ts'
import type { UserPlaylist } from '../../services/music/personal-library.ts'
import type { SearchItem } from '../../shared/music.ts'
import { Icon, Modal } from '../../shared/react/ui.tsx'
import { VolumeSlider } from '../../shared/react/controls.tsx'
import { useReducedMotion } from '../../shared/react/hooks.ts'
import { currentLyricIndex, loadTrackLyrics, type LyricLine } from '../../player-lyrics.ts'
import type { PlayerController } from './player-core.ts'
import type { PlayerPreview } from './types.ts'
import type { MusicQueue } from '../queue/model.ts'
import { createQueuePersistence } from '../queue/persistence.ts'
import { QueueAddFlights, type QueueAddFlightsHandle } from '../queue/QueueAddFlights.tsx'
import { QueuePanel } from '../queue/QueuePanel.tsx'

const FALLBACK_COVER = '/images/album-placeholder-01.svg'
const AUTO_HIDE_DELAY = 320
const COLLECTION_NOTICE_DURATION = 5000

function clock(seconds: number) {
  return Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    : '0:00'
}

function replaceBrokenCover(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  if (!image.src.endsWith('album-placeholder-01.svg')) image.src = FALLBACK_COVER
}

// 只有上层应用会话创建 Audio；本视图只通过 PlayerController 读取与修改播放状态。
export interface PlayerViewProps {
  player: PlayerController
  queue: MusicQueue
  personalLibrary: ReturnType<typeof createPersonalLibraryClient>
  selectedAlbum: PlayerPreview
  defaultTrack: SearchItem
  onExpandedChanged(open: boolean): void
  collectionChanged(): void
  root: RefObject<HTMLElement | null>
}

export interface PlayerViewHandle {
  play(track: SearchItem): Promise<void>
  enqueue(track: SearchItem): void
  choosePlaylist(track: SearchItem): Promise<void>
  syncLiked(): Promise<void>
  closeQueue(): void
  setExpanded(open: boolean, restoreFocus?: boolean): void
  readonly expanded: boolean
}

type QueueLikes = ReadonlyMap<string, boolean>

export const PlayerView = forwardRef<PlayerViewHandle, PlayerViewProps>(function PlayerView(props, ref) {
  const { player, queue, personalLibrary, selectedAlbum, defaultTrack, root } = props
  const reduced = Boolean(useReducedMotion())
  const subscribe = useCallback(
    (onStoreChange: () => void) => player.subscribe(() => onStoreChange()),
    [player],
  )
  const state = useSyncExternalStore(subscribe, player.get, player.get)
  const activeTrack = state.track

  const [queueVersion, setQueueVersion] = useState(0)
  const [queueOpen, setQueueOpenState] = useState(false)
  const [expanded, setExpandedState] = useState(false)
  const [playerVisible, setPlayerVisibleState] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likePending, setLikePending] = useState(false)
  const [pendingLikes, setPendingLikes] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [queueLikes, setQueueLikesState] = useState<QueueLikes>(() => new Map<string, boolean>())
  const [queueOrderStatus, setQueueOrderStatus] = useState('')
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([])
  const [lyricMessage, setLyricMessage] = useState<string | null>('播放音乐后将在这里显示歌词。')
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [collectionBusy, setCollectionBusy] = useState(false)
  const [collectionMessage, setCollectionMessage] = useState('')
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([])
  const [playlistId, setPlaylistId] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // 事件监听器与异步请求只读取 ref，避免闭包拿到旧队列或旧播放状态。
  const queryVersion = queueVersion
  const stateRef = useRef(state)
  stateRef.current = state
  const queueRef = useRef(queue)
  queueRef.current = queue
  const defaultTrackRef = useRef(defaultTrack)
  defaultTrackRef.current = defaultTrack
  const personalLibraryRef = useRef(personalLibrary)
  personalLibraryRef.current = personalLibrary
  const onExpandedChangedRef = useRef(props.onExpandedChanged)
  onExpandedChangedRef.current = props.onExpandedChanged
  const collectionChangedRef = useRef(props.collectionChanged)
  collectionChangedRef.current = props.collectionChanged
  const disposedRef = useRef(false)
  const expandedRef = useRef(false)
  const queueOpenRef = useRef(false)
  const visibleRef = useRef(false)
  const hideTimerRef = useRef(0)
  const animationRef = useRef<QueueAddFlightsHandle | null>(null)
  const persistenceRef = useRef<ReturnType<typeof createQueuePersistence> | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const expandedSectionRef = useRef<HTMLElement | null>(null)
  const queueToggleRef = useRef<HTMLButtonElement | null>(null)
  const queuePanelRef = useRef<HTMLElement | null>(null)
  const openButtonRef = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef(false)
  const lyricScrollRef = useRef<HTMLDivElement | null>(null)
  const lastLyricScrollRef = useRef(-2)
  const lyricRequestRef = useRef(0)
  const lyricAbortRef = useRef<AbortController | null>(null)
  const likeRequestRef = useRef(0)
  const pendingLikesRef = useRef<ReadonlySet<string>>(pendingLikes)
  pendingLikesRef.current = pendingLikes
  const queueLikesRef = useRef<QueueLikes>(queueLikes)
  queueLikesRef.current = queueLikes
  const noticeTimerRef = useRef(0)
  const collectionBusyRef = useRef(false)
  const playlistCandidateRef = useRef<SearchItem | null>(null)

  const setVisible = useCallback((visible: boolean) => {
    visibleRef.current = visible
    setPlayerVisibleState(visible)
  }, [])

  const cancelPlayerHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = 0
  }, [])

  const schedulePlayerHide = useCallback(() => {
    if (animationRef.current?.active) return
    if (hideTimerRef.current || expandedRef.current || queueOpenRef.current) return
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0
      if (expandedRef.current || queueOpenRef.current || animationRef.current?.active) return
      const active = document.activeElement
      if (footerRef.current?.contains(active) && active instanceof HTMLElement && active.matches(':focus-visible')) return
      setVisible(false)
    }, AUTO_HIDE_DELAY)
  }, [setVisible])

  const setQueueOpen = useCallback((open: boolean) => {
    queueOpenRef.current = open
    setQueueOpenState(open)
    if (open) {
      cancelPlayerHide()
      setVisible(true)
    } else schedulePlayerHide()
  }, [cancelPlayerHide, schedulePlayerHide, setVisible])

  const setExpanded = useCallback((open: boolean, restoreFocus = false) => {
    expandedRef.current = open
    restoreFocusRef.current = restoreFocus
    setExpandedState(open)
    onExpandedChangedRef.current(open)
    if (open) {
      setQueueOpen(false)
      cancelPlayerHide()
      setVisible(true)
    } else schedulePlayerHide()
  }, [cancelPlayerHide, schedulePlayerHide, setQueueOpen, setVisible])

  useEffect(() => {
    if (expanded) {
      closeButtonRef.current?.focus()
      return
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      openButtonRef.current?.focus()
      return
    }
    const active = document.activeElement
    if (expandedSectionRef.current?.contains(active) && active instanceof HTMLElement) active.blur()
  }, [expanded])

  const collectionNotice = useCallback((message: string) => {
    if (disposedRef.current) return
    setNotice(message)
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      if (!disposedRef.current) setNotice(null)
    }, COLLECTION_NOTICE_DURATION)
  }, [])

  // 收藏状态请求带请求序号，歌曲切换后旧的响应不会再写入当前按钮。
  const syncLikedFor = useCallback(async (track: SearchItem | null) => {
    if (disposedRef.current) return
    const current = ++likeRequestRef.current
    setLikePending(true)
    if (!track) {
      setLikePending(false)
      return
    }
    try {
      const value = await personalLibrary.isLiked(track)
      if (disposedRef.current || current !== likeRequestRef.current) return
      setLiked(value)
      setLikePending(false)
    } catch (error) {
      if (!disposedRef.current && current === likeRequestRef.current) {
        setLikePending(false)
        collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败')
      }
    }
  }, [collectionNotice, personalLibrary])

  const addPendingLike = useCallback((key: string) => {
    if (pendingLikesRef.current.has(key)) return
    const next = new Set(pendingLikesRef.current)
    next.add(key)
    pendingLikesRef.current = next
    setPendingLikes(next)
  }, [])

  const removePendingLike = useCallback((key: string) => {
    if (!pendingLikesRef.current.has(key)) return
    const next = new Set(pendingLikesRef.current)
    next.delete(key)
    pendingLikesRef.current = next
    setPendingLikes(next)
  }, [])

  const setQueueLike = useCallback((key: string, value: boolean) => {
    const next = new Map(queueLikesRef.current)
    next.set(key, value)
    queueLikesRef.current = next
    setQueueLikesState(next)
  }, [])

  const syncQueueLikes = useCallback((refresh = false) => {
    for (const item of queueRef.current.items) {
      if (pendingLikesRef.current.has(item.key)) continue
      if (!refresh && queueLikesRef.current.has(item.key)) continue
      addPendingLike(item.key)
      void personalLibrary.isLiked(item).then((value) => {
        if (!disposedRef.current) setQueueLike(item.key, value)
      }).catch((error) => {
        if (!disposedRef.current) collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败')
      }).finally(() => {
        if (!disposedRef.current) removePendingLike(item.key)
      })
    }
  }, [addPendingLike, collectionNotice, personalLibrary, removePendingLike, setQueueLike])

  const requestLyrics = useCallback((track: SearchItem) => {
    lyricRequestRef.current += 1
    const request = lyricRequestRef.current
    lyricAbortRef.current?.abort()
    const controller = new AbortController()
    lyricAbortRef.current = controller
    lastLyricScrollRef.current = -2
    setLyricLines([])
    setLyricMessage(track.source === 'local' ? '本地音乐暂无歌词。' : '正在读取歌词…')
    void loadTrackLyrics(track, undefined, controller.signal).then((lines) => {
      if (disposedRef.current || request !== lyricRequestRef.current) return
      setLyricLines(lines)
      setLyricMessage(lines.length ? null : '此歌曲暂无歌词。')
    })
  }, [])

  const clearLyrics = useCallback(() => {
    lyricRequestRef.current += 1
    lyricAbortRef.current?.abort()
    lyricAbortRef.current = null
    lastLyricScrollRef.current = -2
    setLyricLines([])
    setLyricMessage('播放音乐后将在这里显示歌词。')
  }, [])

  const enqueueTrack = useCallback((track: SearchItem) => {
    if (disposedRef.current) return
    const items = queueRef.current.items
    if (items.length >= 500 && !items.some((item) => item.key === track.key)) {
      collectionNotice('播放队列最多保存 500 首，请先移除部分歌曲')
      return
    }
    queueRef.current.add(track)
    setQueueVersion((version) => version + 1)
    persistenceRef.current?.changed()
    animationRef.current?.added()
  }, [collectionNotice])

  const commitQueue = useCallback(() => {
    setQueueVersion((version) => version + 1)
    persistenceRef.current?.changed()
  }, [])

  const handleReorder = useCallback((items: SearchItem[], movedKey?: string) => {
    const current = queueRef.current
    const previousKeys = current.items.map((item) => item.key)
    const key = movedKey && items.some((item) => item.key === movedKey)
      ? movedKey
      : items.find((item, index) => item.key !== previousKeys[index])?.key
    current.restore(items)
    commitQueue()
    const destination = key ? items.findIndex((item) => item.key === key) : -1
    setQueueOrderStatus(destination >= 0 ? `歌曲已移动到第 ${destination + 1} 位` : '')
  }, [commitQueue])

  const play = useCallback((track: SearchItem) => player.play(track), [player])
  const playSafely = useCallback((track: SearchItem) => {
    void player.play(track).catch(() => undefined)
  }, [player])
  const playQueueItem = useCallback((item: SearchItem) => {
    playSafely(item)
  }, [playSafely])
  const removeQueueItem = useCallback((key: string) => {
    queueRef.current.remove(key)
    if (stateRef.current.track?.key === key) player.clear()
    commitQueue()
  }, [commitQueue, player])
  const clearQueue = useCallback(() => {
    queueRef.current.clear()
    player.clear()
    commitQueue()
    setQueueOpen(false)
  }, [commitQueue, player, setQueueOpen])
  const playPrevious = useCallback(() => {
    const track = stateRef.current.track
    if (!track) return
    const previous = queueRef.current.previous(track.key)
    if (previous) playSafely(previous)
  }, [playSafely])
  const playNext = useCallback(() => {
    const track = stateRef.current.track
    if (!track) return
    const next = queueRef.current.next(track.key)
    if (next) playSafely(next)
  }, [playSafely])
  const togglePlayback = useCallback(() => {
    if (!stateRef.current.track) {
      playSafely(defaultTrackRef.current)
      return
    }
    void player.toggle().catch(() => undefined)
  }, [playSafely, player])
  const seekToPointer = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!stateRef.current.track || !Number.isFinite(stateRef.current.duration)) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width) return
    player.seek((event.clientX - bounds.left) / bounds.width)
  }, [player])
  const changeVolume = useCallback((value: number) => {
    // 共享 VolumeSlider 以 0..1 受控值工作；边界再次收敛，避免异常值写进音频元素。
    const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    player.setVolume(next)
  }, [player])

  const toggleLike = useCallback(async (track: SearchItem) => {
    if (disposedRef.current || pendingLikesRef.current.has(track.key)) return
    addPendingLike(track.key)
    try {
      const currentlyLiked = await personalLibrary.isLiked(track)
      if (disposedRef.current) return
      await personalLibrary.setLiked(track, !currentlyLiked)
      if (disposedRef.current) return
      setQueueLike(track.key, !currentlyLiked)
      if (stateRef.current.track?.key === track.key) setLiked(!currentlyLiked)
      collectionNotice(currentlyLiked ? '已取消喜爱' : '已保存到喜爱')
      collectionChangedRef.current()
      void syncLikedFor(stateRef.current.track)
    } catch (error) {
      if (!disposedRef.current) collectionNotice(error instanceof Error ? error.message : '收藏保存失败')
    } finally {
      if (stateRef.current.track?.key === track.key && !disposedRef.current) setLikePending(false)
      if (!disposedRef.current) removePendingLike(track.key)
    }
  }, [addPendingLike, collectionNotice, personalLibrary, removePendingLike, setQueueLike, syncLikedFor])

  const closeCollection = useCallback(() => {
    if (disposedRef.current) return
    setCollectionOpen(false)
  }, [])

  const choosePlaylist = useCallback(async (track: SearchItem) => {
    if (disposedRef.current || collectionBusyRef.current) return
    collectionBusyRef.current = true
    setCollectionBusy(true)
    playlistCandidateRef.current = track
    setCollectionMessage('正在读取歌单…')
    setPlaylists([])
    setPlaylistId('')
    setCollectionOpen(true)
    try {
      const all = await personalLibrary.playlists()
      if (disposedRef.current) return
      setPlaylists(all)
      setPlaylistId(all[0] ? String(all[0].id) : '')
      setCollectionMessage(all.length
        ? `将「${track.title}」保存到歌单。`
        : '还没有歌单，请先到用户页面新建。')
    } catch (error) {
      if (!disposedRef.current) setCollectionMessage(error instanceof Error ? error.message : '歌单读取失败')
    } finally {
      collectionBusyRef.current = false
      if (!disposedRef.current) setCollectionBusy(false)
    }
  }, [personalLibrary])

  const submitCollection = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const candidate = playlistCandidateRef.current
    const id = Number(playlistId)
    if (!candidate || !id || collectionBusyRef.current) return
    collectionBusyRef.current = true
    setCollectionBusy(true)
    try {
      await personalLibrary.addTrack(id, candidate)
      if (disposedRef.current) return
      setCollectionOpen(false)
      collectionNotice('歌曲已保存到歌单')
      collectionChangedRef.current()
    } catch (error) {
      if (!disposedRef.current) {
        setCollectionMessage(error instanceof Error ? error.message : '保存失败')
      }
    } finally {
      collectionBusyRef.current = false
      if (!disposedRef.current) setCollectionBusy(false)
    }
  }, [collectionNotice, personalLibrary, playlistId])

  const onPlayerLike = useCallback(() => {
    const track = stateRef.current.track
    if (!track || pendingLikesRef.current.has(track.key)) return
    void toggleLike(track)
  }, [toggleLike])

  const onFooterClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target
    // 共享音量滑杆是 Radix 的 span 结构而不是 input，整个音量区都不应触发展开。
    if (!(target instanceof Element) || target.closest('button, input, [data-player-volume]')) return
    setExpanded(true)
  }, [setExpanded])

  const onPlayerQueueToggle = useCallback(() => {
    setQueueOpen(!queueOpenRef.current)
  }, [setQueueOpen])

  const openQueueItemSave = useCallback((item: SearchItem) => {
    void choosePlaylist(item)
  }, [choosePlaylist])

  const onQueueItemLike = useCallback((item: SearchItem) => {
    if (pendingLikesRef.current.has(item.key)) return
    void toggleLike(item)
  }, [toggleLike])

  // 队列版本变化时重新渲染；队列本身仍是原 MusicQueue 类，不改成可订阅对象。
  // 首次挂载只读取现有播放状态；歌曲切换时才把新歌加入队列并刷新歌词/收藏。
  const firstTrackRef = useRef(true)
  const lastTrackRef = useRef<SearchItem | null>(null)
  // 组件重新挂载（含开发期双重挂载）时恢复活动标记，不销毁注入的播放器。
  useEffect(() => {
    disposedRef.current = false
    firstTrackRef.current = true
    lastTrackRef.current = null
    pendingLikesRef.current = new Set<string>()
    setPendingLikes(new Set<string>())
    collectionBusyRef.current = false
    return () => {
      disposedRef.current = true
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(noticeTimerRef.current)
      likeRequestRef.current += 1
      lyricRequestRef.current += 1
      lyricAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const track = state.track
    if (firstTrackRef.current) {
      firstTrackRef.current = false
      lastTrackRef.current = track
      if (track) {
        requestLyrics(track)
        void syncLikedFor(track)
      }
      return
    }
    // 播放器状态每次 timeupdate 都会更新，但歌曲对象引用不变时无需重复处理。
    if (track === lastTrackRef.current) return
    lastTrackRef.current = track
    if (!track) {
      likeRequestRef.current += 1
      setLiked(false)
      setLikePending(false)
      clearLyrics()
      return
    }
    void syncLikedFor(track)
    enqueueTrack(track)
    requestLyrics(track)
  }, [state.track])

  useEffect(() => {
    if (!expanded) {
      lastLyricScrollRef.current = -2
      return
    }
    if (lyricLines.length === 0) return
    const index = currentLyricIndex(lyricLines, state.currentTime)
    if (index < 0 || index === lastLyricScrollRef.current) return
    lastLyricScrollRef.current = index
    const line = lyricScrollRef.current?.children.item(index)
    if (line instanceof HTMLElement) {
      line.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' as ScrollBehavior : 'smooth' })
    }
  }, [expanded, lyricLines, reduced, state.currentTime])

  useEffect(() => {
    if (queueOpen) syncQueueLikes(true)
  }, [queueOpen, syncQueueLikes])

  useEffect(() => {
    if (queueOpen) syncQueueLikes(false)
  }, [queueOpen, queryVersion, syncQueueLikes])

  // 队列浮层打开时，点击面板和队标以外的地方关闭；只关闭浮层，不吞掉同一次点击。
  useEffect(() => {
    if (!queueOpen) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (queuePanelRef.current?.contains(target) || queueToggleRef.current?.contains(target)) return
      setQueueOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [queueOpen, setQueueOpen])

  // 靠近视口底部或指针/焦点进入播放器时显示，离开后 320ms 自动隐藏。
  useEffect(() => {
    const pointermove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || expandedRef.current) return
      const target = event.target
      const inside = target instanceof Element
        && Boolean(target.closest('[data-global-player], [data-player-queue-panel]'))
      if (event.clientY >= window.innerHeight - 30 || inside) {
        cancelPlayerHide()
        setVisible(true)
      } else if (visibleRef.current) schedulePlayerHide()
    }
    const pointerout = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-global-player], [data-player-queue-panel]')) return
      const related = event.relatedTarget
      if (related instanceof Element && related.closest('[data-global-player], [data-player-queue-panel]')) return
      schedulePlayerHide()
    }
    const focusin = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-global-player]')) setVisible(true)
    }
    document.addEventListener('pointermove', pointermove)
    document.addEventListener('pointerout', pointerout)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('pointermove', pointermove)
      document.removeEventListener('pointerout', pointerout)
      document.removeEventListener('focusin', focusin)
    }
  }, [cancelPlayerHide, schedulePlayerHide, setVisible])

  const revealForFlight = useCallback(() => { cancelPlayerHide(); setVisible(true) }, [cancelPlayerHide, setVisible])

  // 持久化服务保持原有串行写入与加载竞争处理；视图卸载只销毁该服务，不销毁注入的播放器。
  useEffect(() => {
    const service = createQueuePersistence({
      read: () => queueRef.current.items,
      load: async () => (await personalLibraryRef.current.queue()).map(toPersonalSong),
      save: (tracks) => personalLibraryRef.current.saveQueue(tracks),
      restore: (tracks) => {
        queueRef.current.restore(tracks)
        setQueueVersion((version) => version + 1)
        persistenceRef.current?.changed()
      },
      notice: (message) => collectionNotice(message),
    })
    persistenceRef.current = service
    const retryQueue = () => { void service.retry() }
    const flushQueue = () => { void service.flush() }
    window.addEventListener('online', retryQueue)
    window.addEventListener('pagehide', flushQueue)
    void service.start()
    return () => {
      window.removeEventListener('online', retryQueue)
      window.removeEventListener('pagehide', flushQueue)
      service.destroy()
      if (persistenceRef.current === service) persistenceRef.current = null
    }
  }, [collectionNotice])

  useImperativeHandle(ref, () => ({
    play,
    enqueue: enqueueTrack,
    choosePlaylist,
    syncLiked: () => syncLikedFor(stateRef.current.track),
    closeQueue: () => setQueueOpen(false),
    setExpanded,
    get expanded() { return expandedRef.current },
  }), [choosePlaylist, enqueueTrack, play, setExpanded, setQueueOpen, syncLikedFor])

  // 队列按低频版本生成稳定快照，timeupdate 不会使 500 行 Motion 列表重绘。
  const queueSnapshot = useMemo(() => [...queue.items], [queue, queueVersion])
  const closeQueue = useCallback(() => setQueueOpen(false), [setQueueOpen])
  const focusQueueToggle = useCallback(() => queueToggleRef.current?.focus(), [])
  const removeQueueTrack = useCallback((item: SearchItem) => removeQueueItem(item.key), [removeQueueItem])
  const previewTrack = selectedAlbum.tracks[0]
  const sourceLabel = activeTrack ? (activeTrack.source === 'local' ? 'LOCAL' : 'NETEASE') : 'NETEASE'
  const footerTitle = activeTrack?.title ?? previewTrack?.title ?? '尚未播放歌曲'
  const footerMeta = activeTrack
    ? `${activeTrack.artist} / ${activeTrack.album}`
    : `${selectedAlbum.artist}\u00a0\u00a0/\u00a0\u00a0${selectedAlbum.title}`
  const footerCover = activeTrack?.coverUrl ?? selectedAlbum.coverUrl
  const footerCoverAlt = activeTrack ? `${activeTrack.title} 封面缩略图` : `${selectedAlbum.title} 封面缩略图`
  const footerCurrent = activeTrack ? clock(state.currentTime) : '0:00'
  const footerEnd = activeTrack
    ? (Number.isFinite(state.duration) ? clock(state.duration) : activeTrack.duration)
    : previewTrack?.duration.replace(/^0/, '') ?? '0:00'
  const progressPercent = activeTrack && Number.isFinite(state.duration) && state.duration > 0
    ? `${Math.min(100, state.currentTime / state.duration * 100)}%`
    : '0%'
  // 音量仍由 PlayerController 的单一 Audio 持有；这里只把 0..1 受控值交给共享滑杆。
  const volumeValue = Number.isFinite(state.volume) ? Math.min(1, Math.max(0, state.volume)) : 0
  const queueCount = String(queue.items.length).padStart(2, '0')
  const activeKey = activeTrack?.key
  const playerLikeDisabled = !activeTrack || likePending || (activeTrack ? pendingLikes.has(activeTrack.key) : false)
  const lyricIndex = lyricLines.length ? currentLyricIndex(lyricLines, state.currentTime) : -1
  const expandedTitle = activeTrack?.title ?? '尚未播放歌曲'
  const expandedArtist = activeTrack ? `${activeTrack.artist} / ${activeTrack.album}` : '请选择一首歌曲开始播放'
  const expandedSource = activeTrack
    ? (activeTrack.source === 'local' ? 'LOCAL / 社区音乐' : 'NETEASE / 网易云音乐')
    : 'OPEN MUSIC CLUB'

  return (
    <>
      <QueueAddFlights ref={animationRef} root={root} reduced={reduced} reveal={revealForFlight} finish={schedulePlayerHide} />
      <div className="player-hotspot" data-player-hotspot aria-hidden="true" />
      <section
        ref={expandedSectionRef}
        className={`player-expanded${expanded ? ' is-open' : ''}`}
        data-player-expanded
        role="dialog"
        aria-label="展开播放器与歌词"
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <header className="player-expanded-header">
          <div><strong>OPEN MUSIC CLUB</strong><span>MUSIC ARCHIVE / NOW PLAYING</span></div>
          <button
            ref={closeButtonRef}
            type="button"
            data-player-close
            aria-label="收起播放器"
            onClick={() => setExpanded(false)}
          >
            收起播放器 <span><Icon name="down" /></span>
          </button>
        </header>
        <div className="player-expanded-content">
          <section className="player-expanded-track" aria-label="当前歌曲">
            <p>01 / NOW PLAYING</p>
            <img
              data-expanded-cover
              src={activeTrack?.coverUrl ?? FALLBACK_COVER}
              alt={activeTrack ? `${activeTrack.title} 封面` : '当前歌曲封面'}
              onError={replaceBrokenCover}
            />
            <strong data-expanded-title>{expandedTitle}</strong>
            <span data-expanded-artist>{expandedArtist}</span>
            <small data-expanded-source>{expandedSource}</small>
          </section>
          <section className="player-expanded-lyrics" aria-label="歌词">
            <p>02 / LYRICS · 歌词</p>
            <div className="player-lyrics-scroll" data-player-lyrics aria-live="off" ref={lyricScrollRef}>
              {state.error
                ? <p className="player-lyrics-empty">{state.error}</p>
                : lyricMessage || lyricLines.length === 0
                  ? <p className="player-lyrics-empty">{lyricMessage ?? '此歌曲暂无歌词。'}</p>
                  : lyricLines.map((line, index) => (
                    <p key={`${index}-${line.time}`} className={index === lyricIndex ? 'is-current' : undefined}>{line.text}</p>
                  ))}
            </div>
          </section>
          <ExpandedQueue items={queueSnapshot} activeKey={activeKey} onPlay={playQueueItem} />
        </div>
      </section>
      <footer
        ref={footerRef}
        className={`global-player${playerVisible || expanded ? ' is-visible' : ''}`}
        data-global-player
        aria-label="全站播放器"
        onClick={onFooterClick}
      >
        <section className="player-track" data-player-track>
          <img src={footerCover} alt={footerCoverAlt} onError={replaceBrokenCover} />
          <div><strong>{footerTitle}</strong><span>{footerMeta}</span></div>
          <b><i />{sourceLabel}</b>
          <button
            type="button"
            data-player-like
            aria-label={liked ? '取消收藏歌曲' : '收藏歌曲'}
            aria-pressed={liked}
            disabled={playerLikeDisabled}
            onClick={onPlayerLike}
          >
            <Icon name="heart" filled={liked} />
          </button>
        </section>
        <section className="player-timeline" data-player-progress>
          <time>{footerCurrent}</time>
          <button
            type="button"
            data-player-progress-bar
            aria-label="播放进度"
            disabled={!activeTrack || !Number.isFinite(state.duration)}
            onClick={seekToPointer}
          >
            <i style={{ width: progressPercent }} />
            <b style={{ left: progressPercent }} />
          </button>
          <time>{footerEnd}</time>
        </section>
        <section className="player-controls" data-player-controls>
          <button
            type="button"
            data-player-previous
            aria-label="上一首"
            disabled={!activeTrack || !queue.previous(activeTrack.key)}
            onClick={playPrevious}
          >
            <Icon name="previous" />
          </button>
          <button
            type="button"
            className="player-main-control"
            data-player-toggle
            aria-label={activeTrack && !state.paused ? '暂停' : '播放'}
            onClick={togglePlayback}
          >
            <Icon name={activeTrack && !state.paused ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            data-player-next
            aria-label="下一首"
            disabled={!activeTrack || !queue.next(activeTrack.key)}
            onClick={playNext}
          >
            <Icon name="next" />
          </button>
        </section>
        <section className="player-volume" data-player-volume>
          <Icon name="volume" />
          <VolumeSlider value={volumeValue} onChange={changeVolume} />
        </section>
        <button
          ref={queueToggleRef}
          type="button"
          className="player-queue-summary"
          data-player-queue-toggle
          aria-expanded={queueOpen}
          aria-controls="player-queue-panel"
          onClick={onPlayerQueueToggle}
        >
          <Icon name="queue" /><span data-queue-count>{queueCount}</span>
        </button>
        <div className="player-tail">
          <p>GOOD MUSIC<br />FOR A BRIGHTER TOMORROW.</p>
          <button
            ref={openButtonRef}
            type="button"
            className="player-open"
            data-player-open
            aria-label="展开播放器与歌词"
            onClick={() => setExpanded(true)}
          >
            展开歌词 <span><Icon name="open" /></span>
          </button>
        </div>
      </footer>
      <QueuePanel
        ref={queuePanelRef}
        open={queueOpen}
        items={queueSnapshot}
        activeKey={activeKey}
        reduced={reduced}
        likes={queueLikes}
        pendingLikes={pendingLikes}
        orderStatus={queueOrderStatus}
        onClose={closeQueue}
        onFocusToggle={focusQueueToggle}
        onClear={clearQueue}
        onPlay={playQueueItem}
        onRemove={removeQueueTrack}
        onSave={openQueueItemSave}
        onLike={onQueueItemLike}
        onReorder={handleReorder}
      />
      <p className="collection-feedback" data-collection-feedback role="status" hidden={!notice}>{notice}</p>
      <Modal
        open={collectionOpen}
        onClose={closeCollection}
        busy={collectionBusy}
        className="user-create-dialog"
        data-collection-dialog
        aria-label="将歌曲加入歌单"
      >
        <form data-collection-form onSubmit={submitCollection}>
          <header>
            <span>ADD TO PLAYLIST / 加入歌单</span>
            <button
              type="button"
              data-collection-close
              aria-label="关闭歌单选择"
              onClick={closeCollection}
            >
              <Icon name="close" />
            </button>
          </header>
          <h2>加入歌单</h2>
          <p data-collection-message role="status">{collectionMessage}</p>
          <label htmlFor="collection-playlist">选择自己的歌单</label>
          <select
            id="collection-playlist"
            name="playlist"
            required
            value={playlistId}
            onChange={(event) => setPlaylistId(event.target.value)}
          >
            {playlists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          <div className="user-dialog-actions">
            <button type="button" data-collection-close onClick={closeCollection}>取消</button>
            <button type="submit" disabled={collectionBusy || playlists.length === 0}>
              保存到歌单 <Icon name="right" />
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
})

export default PlayerView

const ExpandedQueue = memo(function ExpandedQueue({ items, activeKey, onPlay }: { items: readonly SearchItem[]; activeKey?: string; onPlay(item: SearchItem): void }) {
  return <section className="player-expanded-queue" aria-label="播放队列"><p>03 / PLAY QUEUE · 播放队列</p>
    <ol data-expanded-queue>{items.map((item, index) => <li key={item.key} className={item.key === activeKey ? 'is-active' : undefined}>
      <button type="button" data-queue-play={item.key} onClick={() => onPlay(item)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><small>{item.artist}</small></button>
    </li>)}</ol><small data-expanded-queue-empty hidden={items.length > 0}>队列为空</small>
  </section>
})
