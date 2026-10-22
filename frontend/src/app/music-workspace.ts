import { createElement } from 'react'
import { mountReactElement } from '../shared/react/mount.ts'
import Workspace, { type WorkspaceProps } from './Workspace.tsx'

// 预览夹具继续注入同一个播放器；普通页面卸载不释放应用音频。
export function mountMusicWorkspace(root: HTMLElement, options: WorkspaceProps) {
  return mountReactElement(root, createElement(Workspace, options))
}
