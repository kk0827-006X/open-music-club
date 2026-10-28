import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FocusEvent, FormEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react'
import { motion } from 'motion/react'
import { Icon, Modal } from '../../shared/react/ui.tsx'
import { usePageMotion, useSectionTransition } from '../../shared/react/page-transitions.ts'
import LineSidebar from '../../shared/react/LineSidebar.tsx'
import { CollapsibleSidebarLayout } from '../../shared/react/CollapsibleSidebarLayout.tsx'
import {
  createPersonalLibraryClient,
  PersonalLibraryError,
  toPersonalSong,
  type PersonalTrack,
  type UserPlaylist,
  type UserProfile,
} from '../../services/music/personal-library.ts'
import { safeCoverUrl, type SearchItem } from '../../services/music/search.ts'
import { AdminApplicationsPage } from '../auth/AdminApplicationsPage.tsx'

type Section = 'playlists' | 'favorites' | 'recent' | 'uploads' | 'admin'
const sections: { id: Section; label: string; english: string }[] = [
  { id: 'playlists', label: '歌单', english: 'PLAYLISTS' },
  { id: 'favorites', label: '喜爱', english: 'FAVORITES' },
  { id: 'recent', label: '最近播放', english: 'RECENTLY PLAYED' },
  { id: 'uploads', label: '我的上传', english: 'MY UPLOADS' },
]
const headings: Record<Section, string> = {
  playlists: '我的歌单',
  favorites: '我的喜爱',
  recent: '最近播放',
  uploads: '我的上传',
  admin: '申请审核',
}
const subtitles: Record<Section, string> = {
  playlists: '把喜欢的音乐，收进自己的档案。',
  favorites: '那些一次又一次想重听的声音。',
  recent: '沿着声音，回到刚刚经过的时刻。',
  uploads: '由你带进社区的每一首音乐。',
  admin: '审核加入申请，系统自动处理验证、激活与通知。',
}
const cover = '/images/album-placeholder-01.svg'

export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '请选择 JPG、PNG 或 WebP 图片。'
  if (file.size === 0 || file.size > 5 * 1024 * 1024) return '请选择大小不超过 5 MB 的有效图片。'
  return null
}

export async function playPlaylistTracks(tracks: PersonalTrack[], options: {
  play?: (song: SearchItem) => Promise<unknown>
  enqueue?: (song: SearchItem) => void
}) {
  const songs = tracks.filter((track) => track.playable).map(toPersonalSong)
  if (!songs.length) return 0
  // 不创建新播放器；全部可用曲目交给原队列，顺序与歌单一致。
  songs.forEach((song) => options.enqueue?.(song))
  await options.play?.(songs[0])
  return songs.length
}

// 歌单详情头部是单一 React 视图：生产页面传入真实重命名状态与 handlers，
// SSR 兼容入口只传 list/playable，不会维护第二份字符串模板。
export interface PlaylistHeaderProps {
  list: Pick<UserPlaylist, 'id' | 'name'>
  playable: boolean
  disabled?: boolean
  renaming?: boolean
  renameValue?: string
  renameInputRef?: Ref<HTMLInputElement>
  onBack?: () => void
  onStartRename?: () => void
  onRenameValueChange?: (value: string) => void
  onRenameSubmit?: () => void
  onRenameKeyDown?: (event: KeyboardEvent<HTMLFormElement>) => void
  onRenameBlur?: (event: FocusEvent<HTMLFormElement>) => void
  onPlay?: () => void
  onDelete?: () => void
}

export function PlaylistHeader({
  list, playable, disabled = false, renaming = false, renameValue, renameInputRef,
  onBack, onStartRename, onRenameValueChange, onRenameSubmit, onRenameKeyDown, onRenameBlur, onPlay, onDelete,
}: PlaylistHeaderProps) {
  return (
    <div className="user-real-list-header">
      <button type="button" className="user-back" data-user-back disabled={disabled} onClick={onBack}><Icon name="left" /> 返回歌单</button>
      <div className="user-playlist-name-wrap">
        <h3>
          <button
            type="button"
            className="user-playlist-name"
            data-user-rename={list.id}
            title="点击修改歌单名称"
            hidden={renaming}
            disabled={disabled}
            onClick={onStartRename}
          >{list.name}</button>
        </h3>
        <form
          className="user-rename-form"
          data-user-rename-form={list.id}
          hidden={!renaming}
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSubmit?.()
          }}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
        >
          <input
            ref={renameInputRef}
            name="name"
            aria-label="歌单名称"
            maxLength={100}
            required
            value={renameValue ?? list.name}
            onChange={(event) => onRenameValueChange?.(event.currentTarget.value)}
          />
          <button className="sr-only" type="submit" disabled={disabled}>保存歌单名称</button>
        </form>
      </div>
      <div className="user-list-detail-actions">
        <button
          type="button"
          className="user-icon-button user-play-button"
          data-user-playlist-play
          aria-label="播放歌单"
          title="播放歌单"
          disabled={!playable || disabled}
          onClick={onPlay}
        ><Icon name="play" /></button>
        <button
          type="button"
          className="user-icon-button user-remove-button"
          data-user-delete={list.id}
          aria-label="删除歌单"
          title="删除歌单"
          disabled={disabled}
          onClick={onDelete}
        ><Icon name="close" /></button>
      </div>
    </div>
  )
}

// 歌曲行同样由生产列表与 createUserTrackMarkup() 共用。
export interface UserTrackRowProps {
  track: PersonalTrack
  liked: boolean
  removable: boolean
  disabled?: boolean
  onAction?: (action: HTMLButtonElement, track: PersonalTrack) => void
}

export function UserTrackRow({ track, liked, removable, disabled = false, onAction }: UserTrackRowProps) {
  const song = toPersonalSong(track)
  const handleAction = onAction
    ? (event: MouseEvent<HTMLButtonElement>) => onAction(event.currentTarget, track)
    : undefined
  return (
    <article className="user-track-row">
      <img src={song.coverUrl} alt="" loading="lazy" />
      <div><strong>{song.title}</strong><small>{song.artist} / {track.source.toUpperCase()}</small></div>
      <div className="user-track-actions">
        <button
          type="button"
          className="user-icon-button user-play-button"
          data-user-play={track.trackKey}
          aria-label={`播放 ${song.title}`}
          title={track.playable ? '播放' : '暂不可用'}
          disabled={!track.playable || disabled}
          onClick={handleAction}
        ><Icon name="play" /></button>
        <button
          type="button"
          className="user-icon-button"
          data-user-enqueue={track.trackKey}
          aria-label={`加入队列 ${song.title}`}
          title="加入队列"
          disabled={!track.playable || disabled}
          onClick={handleAction}
        ><Icon name="plus" /></button>
        <button
          type="button"
          className={`user-icon-button${liked ? ' is-liked' : ''}`}
          data-user-like={track.trackKey}
          aria-pressed={liked}
          aria-label={`${liked ? '取消收藏' : '收藏'} ${song.title}`}
          title={liked ? '取消收藏' : '收藏'}
          disabled={disabled}
          onClick={handleAction}
        ><Icon name="heart" filled={liked} /></button>
        {removable && (
          <button
            type="button"
            className="user-icon-button user-remove-button"
            data-user-remove={track.trackKey}
            aria-label={`移除 ${song.title}`}
            title="从歌单移除"
            disabled={disabled}
            onClick={handleAction}
          ><Icon name="close" /></button>
        )}
      </div>
    </article>
  )
}

function Pagination({ index, more, disabled, onStep }: {
  index: number
  more: boolean
  disabled: boolean
  onStep(step: number): void
}) {
  return (
    <nav className="user-pagination" aria-label="个人音乐翻页">
      <button type="button" data-user-page-step="-1" aria-label="上一页" disabled={disabled || index === 0} onClick={() => onStep(-1)}><Icon name="left" /></button>
      <span>第 {index + 1} 页</span>
      <button type="button" data-user-page-step="1" aria-label="下一页" disabled={disabled || !more} onClick={() => onStep(1)}><Icon name="right" /></button>
    </nav>
  )
}

export interface UserPageProps {
  active: boolean
  role?: 'admin' | 'user'
  play?: (song: SearchItem) => Promise<unknown>
  enqueue?: (song: SearchItem) => void
  choosePlaylist?: (song: SearchItem) => void
  changed?: () => void
  client?: ReturnType<typeof createPersonalLibraryClient>
}

export interface UserPageHandle {
  refresh(): Promise<unknown>
  readonly hasOpenDialog: boolean
}

export const UserPage = forwardRef<UserPageHandle, UserPageProps>(function UserPage(
  { active, role = 'user', play, enqueue, choosePlaylist: _choosePlaylist, changed, client },
  ref,
) {
  const pageMotion = usePageMotion(active)
  const { changing, run: transitionSection, finish: finishSection } = useSectionTransition(active)
  const api = useMemo(() => client || createPersonalLibraryClient(), [client])
  const pageRef = useRef<HTMLElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const unmountedRef = useRef(false)
  const requestRef = useRef(0)
  const profileRevisionRef = useRef(0)
  const playRequestRef = useRef(0)
  const loadingRef = useRef(false)
  const busyRef = useRef(false)
  const avatarBusyRef = useRef(false)
  const renameSessionRef = useRef(0)
  const renameIdRef = useRef<number | null>(null)
  const renameValueRef = useRef('')
  const focusRenameAfterCancelRef = useRef<number | null>(null)
  const selectedIdRef = useRef<number | null>(null)
  const pageIndexRef = useRef(0)
  const sectionRef = useRef<Section>('playlists')
  const listsRef = useRef<UserPlaylist[]>([])
  const tracksRef = useRef<PersonalTrack[]>([])
  const profileRef = useRef<UserProfile | null>(null)
  const coverCacheRef = useRef(new Map<number, string>())
  const openDialogRef = useRef(false)
  const adminDialogRef = useRef(false)
  const adminDialogChanged = useCallback((open: boolean) => { adminDialogRef.current = open }, [])
  const visibleSections = role === 'admin' ? [...sections, { id: 'admin' as const, label: '申请审核', english: 'ADMINISTRATION' }] : sections
  const refreshRef = useRef<() => Promise<boolean>>(async () => false)

  const [section, setSectionState] = useState<Section>('playlists')
  const [selectedId, setSelectedIdState] = useState<number | null>(null)
  const [pageIndex, setPageIndexState] = useState(0)
  const [lists, setListsState] = useState<UserPlaylist[]>([])
  const [tracks, setTracksState] = useState<PersonalTrack[]>([])
  const [loading, setLoadingState] = useState(false)
  const [busy, setBusyState] = useState(false)
  const [playlistPlaying, setPlaylistPlaying] = useState(false)
  const [nickname, setNickname] = useState('REGISTERED MEMBER / 社区成员')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFeedback, setAvatarFeedback] = useState('点击头像更换图片')
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>({ message: '正在读取个人音乐数据…', error: false })
  const [renameId, setRenameIdState] = useState<number | null>(null)
  const [renameValue, setRenameValueState] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState('')

  function setSection(value: Section) { sectionRef.current = value; setSectionState(value) }
  function setSelectedId(value: number | null) { selectedIdRef.current = value; setSelectedIdState(value) }
  function setPageIndex(value: number) { pageIndexRef.current = value; setPageIndexState(value) }
  function setLists(value: UserPlaylist[]) { listsRef.current = value; setListsState(value) }
  function setTracks(value: PersonalTrack[]) { tracksRef.current = value; setTracksState(value) }
  function setLoading(value: boolean) { loadingRef.current = value; setLoadingState(value) }
  function setBusy(value: boolean) { busyRef.current = value; setBusyState(value) }

  function notice(message: string, error = false) {
    if (!unmountedRef.current) setFeedback({ message, error })
  }

  function cancelRename(focusButton = false) {
    // 每次开始/取消都推进会话号，旧输入的 blur 回调不能保存到新一轮重命名。
    renameSessionRef.current += 1
    const id = renameIdRef.current
    renameIdRef.current = null
    renameValueRef.current = ''
    setRenameIdState(null)
    setRenameValueState('')
    if (focusButton && id !== null) focusRenameAfterCancelRef.current = id
  }

  function startRename(list: UserPlaylist) {
    renameSessionRef.current += 1
    renameIdRef.current = list.id
    renameValueRef.current = list.name
    setRenameIdState(list.id)
    setRenameValueState(list.name)
  }

  function saveRename(id: number, session: number) {
    // Escape 会先取消并推进会话号，随后到达的 blur 必须被丢弃。
    if (session !== renameSessionRef.current) return
    if (busyRef.current || unmountedRef.current || renameIdRef.current !== id) return
    const name = renameValueRef.current.trim()
    if (!name || name.length > 100) {
      notice('歌单名称需要填写 1 到 100 个字符', true)
      renameInputRef.current?.focus()
      return
    }
    if (listsRef.current.find((list) => list.id === id)?.name === name) {
      cancelRename()
      return
    }
    cancelRename()
    void mutate(() => api.renamePlaylist(id, name), '歌单名称已保存')
  }

  async function refresh(): Promise<boolean> {
    if (unmountedRef.current) return false
    if (sectionRef.current === 'admin') { setLoading(false); finishSection(); return true }
    const current = ++requestRef.current
    // 重新读取数据时让更早的播放反馈失效，避免旧错误覆盖新的同步结果。
    playRequestRef.current += 1
    // 头像上传成功会推进版本号，较早发出的 profile 响应不能把新头像覆盖回旧值。
    const profileRevision = profileRevisionRef.current
    cancelRename()
    setLoading(true)
    notice('正在读取个人音乐数据…')
    try {
      const nextProfile = await api.profile()
      if (unmountedRef.current || current !== requestRef.current) return false
      if (profileRef.current && profileRef.current.id !== nextProfile.id) {
        listsRef.current = []; setListsState([])
        tracksRef.current = []; setTracksState([])
        selectedIdRef.current = null; setSelectedIdState(null)
        pageIndexRef.current = 0; setPageIndexState(0)
        coverCacheRef.current.clear()
      }
      if (profileRevision === profileRevisionRef.current) {
        profileRef.current = nextProfile
        setNickname(nextProfile.nickname)
        // 头像仅从当前用户的受保护接口读取，不能使用响应中的任意地址。
        setAvatarUrl(nextProfile.avatarUrl)
      }
      if (sectionRef.current === 'playlists') {
        const nextLists = await api.playlists()
        const detail = selectedIdRef.current ? await api.playlist(selectedIdRef.current) : null
        if (unmountedRef.current || current !== requestRef.current) return false
        setLists(nextLists)
        setTracks(detail?.tracks || [])
        if (detail?.tracks[0]) coverCacheRef.current.set(detail.playlist.id, safeCoverUrl(detail.tracks[0].coverUrl))
      } else if (sectionRef.current === 'favorites') {
        let favoritePage = pageIndexRef.current
        let nextTracks = await api.likes(favoritePage * 5)
        if (unmountedRef.current || current !== requestRef.current) return false
        // 喜爱每页 5 首、接口多取 1 首探测下一页；取消最后一首后回退，避免停在空页。
        while (favoritePage > 0 && nextTracks.length === 0) {
          favoritePage -= 1
          nextTracks = await api.likes(favoritePage * 5)
          if (unmountedRef.current || current !== requestRef.current) return false
        }
        if (favoritePage !== pageIndexRef.current) setPageIndex(favoritePage)
        setTracks(nextTracks)
      } else if (sectionRef.current === 'uploads') {
        const nextTracks = await api.uploads(nextProfile.id)
        if (unmountedRef.current || current !== requestRef.current) return false
        setTracks(nextTracks)
      }
      notice('个人数据已同步 · 重新登录后仍会保留')
      return true
    } catch (error) {
      if (current === requestRef.current && !unmountedRef.current) {
        if (error instanceof PersonalLibraryError && error.status === 401) {
          listsRef.current = []; setListsState([])
          tracksRef.current = []; setTracksState([])
          selectedIdRef.current = null; setSelectedIdState(null)
          pageIndexRef.current = 0; setPageIndexState(0)
          profileRef.current = null
          profileRevisionRef.current += 1
          coverCacheRef.current.clear()
          setNickname('会话已失效')
          setAvatarUrl(null)
        }
        notice(error instanceof Error ? error.message : '读取失败，请重试', true)
      }
      return false
    } finally {
      if (!unmountedRef.current && current === requestRef.current) {
        setLoading(false)
        // 以最新请求为准；切换途中触发的外部刷新也能正确结束淡出。
        finishSection()
      }
    }
  }
  refreshRef.current = refresh

  async function mutate(action: () => Promise<unknown>, message: string) {
    if (busyRef.current || unmountedRef.current) return
    setBusy(true)
    try {
      await action()
      if (unmountedRef.current) return
      if (await refreshRef.current()) notice(message)
      changed?.()
    } catch (error) {
      notice(error instanceof Error ? error.message : '保存失败，请重试', true)
    } finally {
      if (!unmountedRef.current) setBusy(false)
    }
  }

  function changeSection(next: Section) {
    // 淡出时保留旧视图，避免先换成空列表再淡出的闪烁。
    requestRef.current += 1
    playRequestRef.current += 1
    transitionSection(() => {
      if (unmountedRef.current) return
      setSection(next)
      setSelectedId(null)
      setPageIndex(0)
      setTracks([])
      void refreshRef.current()
    })
  }

  function openPlaylist(id: number) {
    if (busyRef.current || loadingRef.current) return
    cancelRename()
    playRequestRef.current += 1
    setSelectedId(id)
    setPageIndex(0)
    setTracks([])
    void refreshRef.current()
  }

  function backToPlaylists() {
    if (busyRef.current || loadingRef.current) return
    cancelRename()
    playRequestRef.current += 1
    setSelectedId(null)
    setPageIndex(0)
    void refreshRef.current()
  }

  function onStep(step: number) {
    if (busyRef.current || loadingRef.current) return
    setPageIndex(pageIndexRef.current + step)
    if (sectionRef.current === 'favorites') void refreshRef.current()
  }

  async function playWholePlaylist() {
    if (playlistPlaying || busyRef.current || loadingRef.current) return
    const serial = ++playRequestRef.current
    setPlaylistPlaying(true)
    try {
      const count = await playPlaylistTracks(tracksRef.current, { play, enqueue })
      if (unmountedRef.current || serial !== playRequestRef.current) return
      notice(count ? `歌单中 ${count} 首歌曲已加入队列并开始播放` : '歌单暂无可播放歌曲')
    } catch {
      if (!unmountedRef.current && serial === playRequestRef.current) notice('歌曲暂时无法播放，请稍后重试', true)
    } finally {
      if (!unmountedRef.current) setPlaylistPlaying(false)
    }
  }

  function onTrackAction(action: HTMLButtonElement, track: PersonalTrack) {
    if (action.disabled || busyRef.current || loadingRef.current) return
    const serial = ++playRequestRef.current
    const song = toPersonalSong(track)
    if (action.hasAttribute('data-user-play')) {
      void play?.(song).catch(() => {
        if (!unmountedRef.current && serial === playRequestRef.current) notice('歌曲暂时无法播放，请稍后重试', true)
      })
    } else if (action.hasAttribute('data-user-enqueue')) {
      enqueue?.(song)
      notice('已加入播放队列')
    } else if (action.hasAttribute('data-user-like')) {
      const liked = sectionRef.current === 'favorites' || Boolean(track.liked)
      void mutate(() => api.setLiked(track, !liked), liked ? '已取消喜爱' : '已保存到喜爱')
    } else if (selectedIdRef.current !== null) {
      const playlistId = selectedIdRef.current
      void mutate(() => api.removeTrack(playlistId, track), '已从歌单移除')
    }
  }

  function openCreateDialog() {
    if (busyRef.current || loadingRef.current) return
    setCreateError('')
    setCreateName('')
    setCreateOpen(true)
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = createName.trim()
    if (!name || busyRef.current) return
    setBusy(true)
    try {
      await api.createPlaylist(name)
      if (unmountedRef.current) return
      setCreateOpen(false)
      setSection('playlists')
      setSelectedId(null)
      setPageIndex(0)
      if (await refreshRef.current()) notice('歌单已保存')
      changed?.()
    } catch (error) {
      if (!unmountedRef.current) setCreateError(error instanceof Error ? error.message : '保存失败')
    } finally {
      if (!unmountedRef.current) setBusy(false)
    }
  }

  function openDeleteDialog(list: UserPlaylist) {
    if (busyRef.current || loadingRef.current) return
    setDeletingId(list.id)
    setDeleteError('')
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    const id = deletingId
    if (busyRef.current || loadingRef.current || id === null) return
    setDeleteError('')
    setBusy(true)
    try {
      await api.deletePlaylist(id)
      if (unmountedRef.current) return
      setDeletingId(null)
      setDeleteOpen(false)
      setSelectedId(null)
      setPageIndex(0)
      if (await refreshRef.current()) notice('歌单已删除')
      changed?.()
    } catch (error) {
      if (!unmountedRef.current) setDeleteError(error instanceof Error ? error.message : '删除失败，请重试')
    } finally {
      if (!unmountedRef.current) setBusy(false)
    }
  }

  async function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || avatarBusyRef.current) return
    const error = validateAvatarFile(file)
    if (error) {
      setAvatarFeedback(error)
      return
    }
    avatarBusyRef.current = true
    setAvatarFeedback('正在保存头像…')
    try {
      const saved = await api.uploadAvatar(file)
      if (unmountedRef.current) return
      // 让更早发出的 profile 请求知道头像已被更新，避免旧响应覆盖新头像。
      profileRevisionRef.current += 1
      profileRef.current = saved
      setNickname(saved.nickname)
      setAvatarUrl(saved.avatarUrl)
      setAvatarFeedback('头像已保存，下次登录仍可见')
    } catch (error) {
      if (!unmountedRef.current) setAvatarFeedback(error instanceof Error ? error.message : '头像保存失败')
    } finally {
      avatarBusyRef.current = false
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      requestRef.current += 1
      playRequestRef.current += 1
      renameSessionRef.current += 1
    }
  }, [])

  useEffect(() => {
    // 首次 active 由 App 懒挂载；重新进入用户页时按旧导航行为刷新数据。
    if (active) void refreshRef.current()
  }, [active])

  useEffect(() => {
    if (createOpen) createInputRef.current?.focus()
  }, [createOpen])

  useEffect(() => {
    if (renameId !== null) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
      return
    }
    // Escape 取消后把焦点还给原歌单名称按钮。
    const id = focusRenameAfterCancelRef.current
    if (id === null) return
    focusRenameAfterCancelRef.current = null
    pageRef.current?.querySelector<HTMLButtonElement>(`[data-user-rename="${id}"]`)?.focus()
  }, [renameId])

  useEffect(() => {
    // 歌单数量变化时把页码收回有效范围，避免停在已不存在的页。
    if (section !== 'playlists' || selectedId !== null) return
    const maxPage = Math.max(0, Math.ceil(lists.length / 3) - 1)
    if (pageIndexRef.current > maxPage) setPageIndex(maxPage)
  }, [lists.length, section, selectedId])

  useImperativeHandle(ref, () => ({
    refresh: () => refreshRef.current(),
    get hasOpenDialog() { return openDialogRef.current || adminDialogRef.current },
  }), [])

  openDialogRef.current = createOpen || deleteOpen
  const avatarSrc = avatarUrl && /^\/api\/me\/avatar\?v=[a-z0-9-]+$/.test(avatarUrl) ? avatarUrl : undefined
  const contentDisabled = busy || loading
  const deletingName = lists.find((list) => list.id === deletingId)?.name || ''
  const selectedList = selectedId !== null ? lists.find((list) => list.id === selectedId) : undefined
  const playlistPlayable = !playlistPlaying && tracks.some((track) => track.playable)
  // 渲染时固定当前重命名会话；Escape 取消后旧输入触发的 blur 会带着旧会话号被丢弃。
  const renameSession = renameSessionRef.current

  let contentBody: ReactNode
  if (section === 'admin') {
    contentBody = active && role === 'admin' ? <AdminApplicationsPage embedded onDialogChange={adminDialogChanged} /> : null
  } else if (section === 'playlists' && selectedId === null) {
    const maxPage = Math.max(0, Math.ceil(lists.length / 3) - 1)
    const visibleIndex = Math.min(pageIndex, maxPage)
    contentBody = (
      <>
        <div className="user-collection-intro"><span>MY PLAYLISTS</span><strong>{lists.length} <small>份声音档案</small></strong></div>
        <div className="user-playlist-grid">
          {lists.slice(visibleIndex * 3, visibleIndex * 3 + 3).map((list, index) => (
            <button
              key={list.id}
              type="button"
              className={`user-playlist-card${index === 0 ? ' is-featured' : ''}`}
              data-user-list={list.id}
              disabled={contentDisabled}
              onClick={() => openPlaylist(list.id)}
            >
              <span className="user-playlist-art"><img src={coverCacheRef.current.get(list.id) || cover} alt="" loading="lazy" /></span>
              <span className="user-playlist-meta"><strong>{list.name}</strong><small>{list.trackCount} 首歌曲</small><b><Icon name="open" /></b></span>
            </button>
          ))}
          <button type="button" className="user-new-card" data-user-create disabled={contentDisabled} onClick={openCreateDialog}>
            <span><Icon name="plus" /></span><strong>新建歌单</strong><small>CREATE A NEW ARCHIVE</small>
          </button>
        </div>
        <Pagination index={visibleIndex} more={(visibleIndex + 1) * 3 < lists.length} disabled={contentDisabled} onStep={onStep} />
      </>
    )
  } else if (section === 'recent') {
    contentBody = (
      <div className="user-empty-state">
        <span className="user-empty-symbol">↺</span>
        <h3>播放记录尚未开启</h3>
        <p>历史记录功能将单独接入，不使用临时队列冒充记录。</p>
      </div>
    )
  } else {
    const visibleTracks = section === 'favorites' ? tracks.slice(0, 5) : tracks.slice(pageIndex * 5, pageIndex * 5 + 5)
    const more = section === 'favorites' ? tracks.length > 5 : (pageIndex + 1) * 5 < tracks.length
    const removable = selectedId !== null
    contentBody = (
      <>
        {selectedList && (
          <PlaylistHeader
            list={selectedList}
            playable={playlistPlayable}
            disabled={contentDisabled}
            renaming={renameId === selectedList.id}
            renameValue={renameValue}
            renameInputRef={renameInputRef}
            onBack={backToPlaylists}
            onStartRename={() => startRename(selectedList)}
            onRenameValueChange={(value) => { renameValueRef.current = value; setRenameValueState(value) }}
            onRenameSubmit={() => saveRename(selectedList.id, renameSession)}
            onRenameKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              cancelRename(true)
            }}
            onRenameBlur={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
              saveRename(selectedList.id, renameSession)
            }}
            onPlay={() => void playWholePlaylist()}
            onDelete={() => openDeleteDialog(selectedList)}
          />
        )}
        <div className="user-track-list">
          {visibleTracks.length === 0
            ? <p className="user-data-empty">暂无歌曲。可从播放队列添加歌曲到歌单，或点击歌曲旁的心形收藏。</p>
            : visibleTracks.map((track) => (
              <UserTrackRow
                key={track.trackKey}
                track={track}
                liked={section === 'favorites' || Boolean(track.liked)}
                removable={removable}
                disabled={contentDisabled}
                onAction={onTrackAction}
              />
            ))}
        </div>
        <Pagination index={pageIndex} more={more} disabled={contentDisabled} onStep={onStep} />
      </>
    )
  }

  return (
    <motion.section
      ref={pageRef}
      className="user-page"
      data-user-page
      {...pageMotion}
      aria-label="个人音乐空间"
    >
      <CollapsibleSidebarLayout active={active} variant="user" sidebarClassName="user-sidebar" sidebar={expanded => <>
        <p className="user-eyebrow">MEMBER ARCHIVE / 个人音乐空间</p>
        <div className="user-profile">
          <button type="button" className="user-avatar" data-user-avatar-choose aria-label="选择本地图片作为头像" onClick={() => { if (!avatarBusyRef.current) avatarInputRef.current?.click() }}>
            <span data-user-avatar-placeholder hidden={Boolean(avatarUrl)}>OMC</span>
            <img data-user-avatar-image hidden={!avatarUrl} src={avatarSrc} alt="用户头像" />
            <b>更换头像</b><i></i>
          </button>
          <input
            ref={avatarInputRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            data-user-avatar-file
            aria-label="选择头像图片"
            tabIndex={-1}
            onChange={(event) => void onAvatarChange(event)}
          />
        </div>
        <div className="user-identity">
          <small data-user-nickname>{nickname}</small>
          <p data-user-avatar-feedback role="status">{avatarFeedback}</p>
        </div>
        <LineSidebar ariaLabel="个人音乐分类" items={visibleSections.map(item => item.label)}
          activeIndex={visibleSections.findIndex(item => item.id === section)} enabled={active && expanded}
          showIndex={false} markerLength={26} markerGap={12} maxShift={12} itemGap={16} fontSize={.83}
          className="member-line-sidebar" getItemProps={index => ({ 'data-user-tab': visibleSections[index].id, title: visibleSections[index].label })}
          renderLabel={(label, index) => <><strong>{label}</strong><small>{visibleSections[index].english}</small></>}
          onItemClick={index => changeSection(visibleSections[index].id)} />
        <p className="user-sidebar-foot"><i></i> YOUR MUSIC, YOUR ARCHIVE<br />音乐从这里开始归档</p>
      </>}>
      <div className="user-content-shell">
        <header className="user-content-header">
          <div><p>{section === 'admin' ? 'ADMINISTRATION / 成员审核' : 'PERSONAL COLLECTION / 个人收藏'}</p><h2 data-user-heading>{headings[section]}</h2><span data-user-subtitle>{subtitles[section]}</span></div>
        </header>
        <div className={`user-content section-content${changing ? ' is-changing' : ''}`} data-user-content inert={changing} aria-live="polite" aria-busy={busy || loading || changing}>
          {contentBody}
        </div>
        <p className="user-preview-note" data-user-feedback role="status" data-error={String(feedback.error)}>{section === 'admin' ? '' : feedback.message}</p>
      </div>
      </CollapsibleSidebarLayout>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        className="user-create-dialog"
        data-user-dialog
        aria-labelledby="user-dialog-title"
      >
        <form data-user-create-form onSubmit={(event) => void onCreateSubmit(event)}>
          <header><span>PERSONAL ARCHIVE</span><button type="button" data-user-dialog-close aria-label="关闭歌单编辑窗口" onClick={() => setCreateOpen(false)}><Icon name="close" /></button></header>
          <h2 id="user-dialog-title" data-user-dialog-title>新建歌单</h2>
          <p>保存后，下次登录仍能看到这份声音档案。</p>
          <label htmlFor="user-playlist-name">歌单名称</label>
          <input
            id="user-playlist-name"
            ref={createInputRef}
            name="name"
            maxLength={100}
            required
            placeholder="例如：夜晚的留声机"
            value={createName}
            onChange={(event) => setCreateName(event.currentTarget.value)}
          />
          <p data-user-dialog-feedback role="status">{createError}</p>
          <div className="user-dialog-actions">
            <button type="button" data-user-dialog-cancel onClick={() => setCreateOpen(false)}>取消</button>
            <button type="submit" disabled={busy}><span data-user-dialog-submit>创建歌单</span> <span><Icon name="right" /></span></button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => { if (!busyRef.current) { setDeletingId(null); setDeleteOpen(false) } }}
        busy={busy}
        className="user-create-dialog user-delete-dialog"
        data-user-delete-dialog
        aria-labelledby="user-delete-title"
        aria-describedby="user-delete-description"
      >
        <header>
          <span>PERSONAL ARCHIVE</span>
          <button type="button" data-user-delete-cancel aria-label="关闭删除确认窗口" disabled={busy} onClick={() => { setDeletingId(null); setDeleteOpen(false) }}><Icon name="close" /></button>
        </header>
        <h2 id="user-delete-title">删除这份歌单？</h2>
        <p id="user-delete-description">确定删除「<strong data-user-delete-name>{deletingName}</strong>」吗？此操作不可撤销，但不会删除音乐文件。</p>
        <p data-user-delete-feedback role="status">{deleteError}</p>
        <div className="user-dialog-actions">
          <button type="button" data-user-delete-cancel autoFocus disabled={busy} onClick={() => { setDeletingId(null); setDeleteOpen(false) }}>取消</button>
          <button type="button" className="user-confirm-delete" data-user-delete-confirm disabled={busy || loading} onClick={() => void confirmDelete()}>确认删除</button>
        </div>
      </Modal>
    </motion.section>
  )
})

export default UserPage
