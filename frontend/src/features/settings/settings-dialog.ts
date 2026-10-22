import { createElement, createRef } from 'react'
import { mountReactElement } from '../../shared/react/mount.ts'
import { SettingsDialog, type SettingsDialogHandle } from './SettingsDialog.tsx'

// 独立宿主避免旧调用方的工作区 DOM 被 createRoot 接管或清空。
export function mountSettingsDialog(root: HTMLElement, options: { logout?: () => Promise<void>; onOpen: () => void; onClose: () => void }) {
  const host = root.ownerDocument.createElement('div')
  root.append(host)
  const handle = createRef<SettingsDialogHandle>()
  const unmount = mountReactElement(host, createElement(SettingsDialog, { ref: handle, ...options }))
  return {
    get open() { return handle.current?.open ?? false },
    show(opener?: HTMLElement) { handle.current?.show(opener) },
    destroy() { unmount(); host.remove() },
  }
}
