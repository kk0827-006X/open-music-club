import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LibraryView, type LibraryViewHandle } from '../features/music-library/LibraryView.tsx'
import { demoAlbums, type DemoAlbum } from '../features/music-library/album-data.ts'
import { albumTrack } from '../features/music-library/tracks.ts'
import { PlayerView, type PlayerViewHandle } from '../features/player/PlayerView.tsx'
import type { PlayerController } from '../features/player/player-core.ts'
import type { MusicQueue } from '../features/queue/model.ts'
import type { SearchPageHandle } from '../features/search/SearchPage.tsx'
import type { UserPageHandle } from '../features/user/UserPage.tsx'
import { SettingsDialog, type SettingsDialogHandle } from '../features/settings/SettingsDialog.tsx'
import { createPersonalLibraryClient } from '../services/music/personal-library.ts'
import { mountArchiveScene, type ArchiveSceneController } from '../graphics/archive/scene-host.ts'
import { Brand, Icon } from '../shared/react/ui.tsx'
import { useReducedMotion } from '../shared/react/hooks.ts'
import type { MusicActions } from '../shared/music.ts'
import { ErrorBoundary } from '../shared/react/ErrorBoundary.tsx'
import { createFootprintClient } from '../services/music/footprint.ts'
import type { FootprintPageHandle } from '../features/footprint/FootprintPage.tsx'

const SearchPage = lazy(() => import('../features/search/SearchPage.tsx'))
const UploadPage = lazy(() => import('../features/upload/UploadPage.tsx'))
const UserPage = lazy(() => import('../features/user/UserPage.tsx'))
const FootprintPage = lazy(() => import('../features/footprint/FootprintPage.tsx'))
type Page = 'archive' | 'search' | 'upload' | 'user' | 'footprint'
const tabs = [['library', '音乐库', 'library'], ['search', '搜索', 'search'], ['upload', '上传音乐', 'upload'], ['footprint', '音乐足迹', 'route'], ['user', '用户', 'user']] as const

export interface WorkspaceProps {
  role?: 'admin' | 'user'
  player: PlayerController
  queue: MusicQueue
  personalLibrary?: ReturnType<typeof createPersonalLibraryClient>
  footprintClient?: ReturnType<typeof createFootprintClient>
  footprintRevision?: number
  onLogout?: () => Promise<void>
  loadScene?: () => Promise<ArchiveSceneController>
  initialIndex?: number
}
export default function Workspace({ role = 'user', player, queue, personalLibrary, footprintClient, footprintRevision = 0, onLogout, loadScene, initialIndex = 0 }: WorkspaceProps) {
  const archive = useRef<HTMLElement>(null)
  const sceneContainer = useRef<HTMLDivElement>(null)
  const library = useRef<LibraryViewHandle>(null)
  const playerView = useRef<PlayerViewHandle>(null)
  const settings = useRef<SettingsDialogHandle>(null)
  const search = useRef<SearchPageHandle>(null)
  const user = useRef<UserPageHandle>(null)
  const footprint = useRef<FootprintPageHandle>(null)
  const reduced = useReducedMotion()
  const [scene, setScene] = useState<ReturnType<typeof mountArchiveScene> | null>(null)
  const [page, setPage] = useState<Page>('archive')
  const [visited, setVisited] = useState<Set<Page>>(() => new Set())
  const [selected, setSelected] = useState<DemoAlbum>(demoAlbums[initialIndex])
  const [expanded, setExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const client = useMemo(() => personalLibrary ?? createPersonalLibraryClient(), [personalLibrary])
  const footprints = useMemo(() => footprintClient ?? createFootprintClient(), [footprintClient])
  const sceneInputs = useRef({ loadScene, reduced })
  sceneInputs.current = { loadScene, reduced }
  useLayoutEffect(() => {
    if (!sceneContainer.current) return
    const host = mountArchiveScene(sceneContainer.current, {
      reduced: sceneInputs.current.reduced, initialRecord: 16, covers: demoAlbums.map(album => album.coverUrl),
      loadScene: sceneInputs.current.loadScene,
      afterUpdate: (visibility, now) => library.current?.afterUpdate(visibility, now) ?? true,
      onSelect: (index, cell) => library.current?.selectRecord(index, cell ? { cell } : undefined),
      onNavigate: (axis, direction) => library.current?.navigate(axis, direction),
    })
    setScene(host)
    return () => host.destroy()
  }, [loadScene])
  useEffect(() => {
    scene?.setVisible(page === 'archive' && !expanded && !settingsOpen)
  }, [scene, page, expanded, settingsOpen])
  const show = useCallback((next: Page) => {
    if (next !== 'archive') {
      library.current?.resetDetail()
      setVisited(previous => new Set(previous).add(next))
    }
    setPage(next)
    if (next === 'search') search.current?.focus()
  }, [])
  const actions = useMemo<MusicActions>(() => ({
    play: track => playerView.current?.play(track) ?? Promise.resolve(),
    enqueue: track => playerView.current?.enqueue(track),
  }), [])
  const collectionChanged = useCallback(() => { if (page === 'user') void user.current?.refresh() }, [page])
  useEffect(() => {
    if (page === 'search') search.current?.focus()
  }, [page])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || settings.current?.open) return
      if (playerView.current?.expanded) {
        if (event.key === 'Escape') { event.preventDefault(); playerView.current.setExpanded(false, true) }
        return
      }
      if (page !== 'archive') {
        if (event.key === 'Escape' && !(page === 'user' && user.current?.hasOpenDialog) && !(page === 'footprint' && footprint.current?.hasOpenDialog)) { event.preventDefault(); show('archive') }
        else if (page === 'search' && event.key === '/' && !search.current?.ownsKeyboardTarget(event.target)) { event.preventDefault(); search.current?.focus() }
        return
      }
      if (library.current?.mode === 'detail') {
        if (event.key === 'Escape') { event.preventDefault(); library.current.closeDetail() }
        return
      }
      if (event.key === '/') { event.preventDefault(); show('search'); return }
      const arrows = { ArrowUp: ['row', -1], ArrowDown: ['row', 1], ArrowLeft: ['lane', -1], ArrowRight: ['lane', 1] } as const
      if (event.key in arrows) {
        event.preventDefault()
        const [axis, direction] = arrows[event.key as keyof typeof arrows]
        library.current?.navigate(axis, direction)
      }
      if (event.key === 'Enter') library.current?.openDetail()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [page, show])
  return <main ref={archive} className="album-archive" data-album-archive data-view={page} onErrorCapture={event => {
    const image = event.target
    if (image instanceof HTMLImageElement && !image.src.endsWith('/images/album-placeholder-01.svg')) image.src = '/images/album-placeholder-01.svg'
  }}>
    <Brand statistics />
    <nav className="archive-nav" data-archive-navigation aria-label="音乐功能预览">
      {tabs.map(([id, label, icon]) => <button key={id} type="button" data-nav={id} aria-current={page === (id === 'library' ? 'archive' : id) ? 'page' : undefined} onClick={() => show(id === 'library' ? 'archive' : id)}><Icon name={icon} /><span>{label}</span></button>)}
      <i aria-hidden="true" />
      <button type="button" data-nav="settings" onClick={event => { playerView.current?.closeQueue(); settings.current?.show(event.currentTarget) }}><Icon name="settings" /><span>设置</span></button>
    </nav>
    <section className="album-wave-stage" data-wave-field aria-label="三维专辑档案选择" inert={page !== 'archive'}><div ref={sceneContainer} className="archive-three-scene" data-three-scene /></section>
    <LibraryView ref={library} scene={scene} actions={actions} onSelected={setSelected} onModeChanged={() => undefined} active={page === 'archive'} initialIndex={initialIndex} />
    <ErrorBoundary><Suspense fallback={null}>
      <div data-search-host>{visited.has('search') && <SearchPage ref={search} active={page === 'search'} {...actions} />}</div>
      <div data-upload-host onClick={event => { if (event.target instanceof Element && event.target.closest('[data-upload-back]')) show('archive') }}>{visited.has('upload') && <UploadPage active={page === 'upload'} />}</div>
      <div data-user-host>{visited.has('user') && <UserPage ref={user} active={page === 'user'} role={role} {...actions} client={client} choosePlaylist={track => { void playerView.current?.choosePlaylist(track) }} changed={() => { void playerView.current?.syncLiked() }} />}</div>
      <div data-footprint-host>{visited.has('footprint') && <FootprintPage ref={footprint} active={page === 'footprint'} {...actions} client={footprints} revision={footprintRevision} />}</div>
    </Suspense></ErrorBoundary>
    <PlayerView ref={playerView} player={player} queue={queue} personalLibrary={client} root={archive} selectedAlbum={selected} defaultTrack={albumTrack(selected)} onExpandedChanged={setExpanded} collectionChanged={collectionChanged} />
    <SettingsDialog ref={settings} logout={onLogout} onOpen={() => setSettingsOpen(true)} onClose={() => setSettingsOpen(false)} />
  </main>
}
