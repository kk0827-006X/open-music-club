import { createElement } from 'react'
import { renderReactMarkup } from '../shared/react/mount.ts'
import Workspace from './Workspace.tsx'
import { MusicQueue } from '../features/queue/model.ts'
import { createPreviewPlayer } from '../features/player/preview-state.ts'

// 旧静态预览使用真正组件的 SSR，不再维护第二份工作区 HTML。
export function createAlbumArchiveMarkup(selectedIndex = 0) {
  return renderReactMarkup(createElement(Workspace, { player: createPreviewPlayer(), queue: new MusicQueue(), initialIndex: selectedIndex }))
}
