import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

// 仅为预览夹具及旧调用者保留的边界；所有界面都由同一套 React 组件渲染。
export function mountReactElement(container: HTMLElement, element: ReactNode) {
  const root = createRoot(container)
  flushSync(() => root.render(element))
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    flushSync(() => root.unmount())
  }
}
export const renderReactMarkup = (element: ReactNode) => renderToStaticMarkup(element)
