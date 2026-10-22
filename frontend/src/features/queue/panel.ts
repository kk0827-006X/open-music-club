import { createElement } from 'react'
import { QueuePanel, type QueuePanelProps } from './QueuePanel.tsx'
import { renderReactMarkup } from '../../shared/react/mount.ts'
import type { SearchItem } from '../../shared/music.ts'

export { QueuePanel }
// 兼容静态预览；与生产共用 React 视图，不保留第二套拖拽引擎。
function markup(items: readonly SearchItem[] = [], activeKey?: string, likes = new Map<string, boolean>()) {
  const noop = () => undefined
  const props: QueuePanelProps = { open: false, items, activeKey, likes, reduced: true, pendingLikes: new Set(), orderStatus: '',
    onClose: noop, onFocusToggle: noop, onClear: noop, onPlay: noop, onRemove: noop, onSave: noop, onLike: noop, onReorder: noop }
  return renderReactMarkup(createElement(QueuePanel, props))
}
export function createQueuePanelMarkup() { return markup() }
export function createQueueItemsMarkup(items: readonly SearchItem[], activeKey?: string, likes = new Map<string, boolean>()) {
  return markup(items, activeKey, likes).match(/<ol[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? ''
}
