// 旧调用方兼容入口：新业务逻辑位于 app 与 features，不在此追加实现。
import { mountMusicWorkspace } from './app/music-workspace.ts'
import { createPlayerController } from './features/player/player-core.ts'
import { MusicQueue } from "./features/queue/model.ts"
import { resolvePlaybackUrl } from "./services/music/search.ts"
export { createAlbumArchiveMarkup } from './app/workspace-view.ts'
export { createAlbumDetailMarkup, wrapAlbumIndex } from './features/music-library/library-view.ts'
export { createPlayerMarkup } from './features/player/player-markup.ts'

export function mountAlbumArchive(root: HTMLElement, options: { onLogout?: () => Promise<void> } = {}) {
  const queue = new MusicQueue()
  const player = createPlayerController({ queue, resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal) })
  const destroy = mountMusicWorkspace(root, { ...options, queue, player })
  return () => { destroy(); player.destroy() }
}
