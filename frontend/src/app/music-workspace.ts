import { createAlbumArchiveMarkup } from './workspace-view.ts'
import { demoAlbums } from "../features/music-library/album-data.ts"
import { createNavigation } from './navigation.ts'
import { mountMusicLibrary, albumTrack } from '../features/music-library/library-controller.ts'
import { mountPlayerView } from '../features/player/player-view.ts'
import type { PlayerController } from '../features/player/player-core.ts'
import type { MusicQueue } from "../features/queue/model.ts"
import { createPersonalLibraryClient } from "../services/music/personal-library.ts"
import { mountSearchPage } from "../features/search/search-page.ts"
import { mountUploadPage } from "../features/upload/upload-page.ts"
import { mountUserPage } from "../features/user/user-page.ts"
import { mountSettingsDialog } from "../features/settings/settings-dialog.ts"
import { mountArchiveScene, type ArchiveSceneController } from '../graphics/archive/scene-host.ts'

// 认证后的工作区装配：页面只请求公开动作，音频实例属于上级应用会话。
export function mountMusicWorkspace(root: HTMLElement, options: {
  player: PlayerController; queue: MusicQueue
  personalLibrary?: ReturnType<typeof createPersonalLibraryClient>
  onLogout?: () => Promise<void>
  loadScene?: () => Promise<ArchiveSceneController>
}) {
  root.innerHTML = createAlbumArchiveMarkup()
  const archive = root.querySelector<HTMLElement>('[data-album-archive]')!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const personalLibrary = options.personalLibrary ?? createPersonalLibraryClient()
  let disposed = false
  const scene = mountArchiveScene(archive.querySelector<HTMLElement>('[data-three-scene]')!, {
    reduced, initialRecord: 16, covers: demoAlbums.map(album => album.coverUrl), loadScene: options.loadScene,
    afterUpdate: (visibility, now) => library.afterUpdate(visibility, now),
    onSelect: (index, cell) => library.selectRecord(index, cell ? { cell } : undefined),
    onNavigate: (axis, direction) => library.navigate(axis, direction),
  })
  const library = mountMusicLibrary(archive, { scene, actions: {
    play: track => playerView.play(track), enqueue: track => playerView.enqueue(track),
  }, previewChanged: () => playerView.refreshPreview() })
  const playerView = mountPlayerView(archive, {
    player: options.player, queue: options.queue, personalLibrary, reduced,
    selectedAlbum: () => library.selectedAlbum, defaultTrack: () => albumTrack(library.selectedAlbum),
    onExpandedChanged: () => updateSceneVisibility(),
    collectionChanged: () => { if (navigation.current === 'user') navigation.controller('user')?.refresh?.() },
  })
  const host = (name: string) => archive.querySelector<HTMLElement>(`[data-${name}-host]`)!
  const navigation = createNavigation(archive, { reduced,
    resetArchive: library.resetDetail,
    changed: view => { library.setInert(view !== 'archive'); updateSceneVisibility() },
    pages: {
      search: { delay: 280, mount: () => mountSearchPage(host('search'), playerView.play, undefined, playerView.enqueue) },
      upload: { delay: 300, mount: () => mountUploadPage(host('upload')) },
      user: { delay: 300, mount: () => mountUserPage(host('user'), {
        client: personalLibrary, play: playerView.play, enqueue: playerView.enqueue,
        choosePlaylist: song => { void playerView.choosePlaylist(song) }, changed: () => { void playerView.syncLiked() },
      }) },
    },
  })
  const settings = mountSettingsDialog(archive, {
    logout: options.onLogout, onOpen: () => scene.setVisible(false), onClose: () => updateSceneVisibility(),
  })
  function updateSceneVisibility() {
    if (!disposed) scene.setVisible(navigation.current === 'archive' && !playerView.expanded && !settings.open)
  }
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const button = target?.closest<HTMLElement>('[data-nav]')
    switch (button?.dataset.nav) {
      case 'search': navigation.show('search'); return
      case 'upload': navigation.show('upload'); return
      case 'user': navigation.show('user'); return
      case 'library': navigation.hide(); return
      case 'settings': playerView.closeQueue(); settings.show(button!); return
    }
    if (target?.closest('[data-upload-back]')) navigation.hide()
  }
  const keyboard = (event: KeyboardEvent) => {
    if (settings.open) return
    if (playerView.expanded) {
      if (event.key === 'Escape') { event.preventDefault(); playerView.setExpanded(false, true) }
      return
    }
    const page = navigation.active()
    if (page) {
      if (event.key === 'Escape' && !page.hasOpenDialog) { event.preventDefault(); navigation.hide() }
      else if (navigation.current === 'search' && event.key === '/' && !page.ownsKeyboardTarget?.(event.target)) { event.preventDefault(); page.focus?.() }
      return
    }
    if (library.mode === 'detail') {
      if (event.key === 'Escape') { event.preventDefault(); library.closeDetail() }
      return
    }
    if (event.key === '/') { event.preventDefault(); navigation.show('search'); return }
    const arrows = { ArrowUp: ['row', -1], ArrowDown: ['row', 1], ArrowLeft: ['lane', -1], ArrowRight: ['lane', 1] } as const
    if (event.key in arrows) { event.preventDefault(); const [axis, direction] = arrows[event.key as keyof typeof arrows]; library.navigate(axis, direction) }
    if (event.key === 'Enter') library.openDetail()
  }
  archive.addEventListener('click', click)
  window.addEventListener('keydown', keyboard)
  return () => {
    if (disposed) return
    disposed = true
    archive.removeEventListener('click', click); window.removeEventListener('keydown', keyboard)
    navigation.destroy(); settings.destroy(); library.destroy(); playerView.destroy(); scene.destroy()
    root.replaceChildren()
  }
}
