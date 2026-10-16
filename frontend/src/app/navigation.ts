export type WorkspacePage = 'search' | 'upload' | 'user'
// element 是页面公开的根节点；协调器不查询页面私有 DOM。
export interface PageController {
  element: HTMLElement
  focus?(): void
  refresh?(): unknown
  readonly hasOpenDialog?: boolean
  ownsKeyboardTarget?(target: EventTarget | null): boolean
  destroy(): void
}
export function createNavigation(root: HTMLElement, options: {
  pages: Record<WorkspacePage, { delay: number; mount(): PageController }>
  reduced: boolean
  resetArchive(): void
  changed(view: 'archive' | WorkspacePage): void
}) {
  const controllers = new Map<WorkspacePage, PageController>()
  const timers = new Map<WorkspacePage, number>()
  let current: 'archive' | WorkspacePage = 'archive', frame = 0, disposed = false
  const mark = (name: string) => {
    root.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(button => {
      if (button.dataset.nav === name) button.setAttribute('aria-current', 'page')
      else if (button.dataset.nav !== 'settings') button.removeAttribute('aria-current')
    })
  }
  function hide() {
    if (disposed || current === 'archive') return
    const name = current, page = controllers.get(name)!
    current = 'archive'; root.dataset.view = 'archive'; mark('library')
    page.element.inert = true
    window.cancelAnimationFrame(frame); frame = 0
    window.clearTimeout(timers.get(name))
    timers.set(name, window.setTimeout(() => {
      timers.delete(name)
      if (!disposed && current !== name) page.element.hidden = true
    }, options.reduced ? 0 : options.pages[name].delay))
    options.changed('archive')
  }
  return {
    get current() { return current },
    active: () => current === 'archive' ? null : controllers.get(current)!,
    controller: (name: WorkspacePage) => controllers.get(name),
    show(name: WorkspacePage) {
      if (disposed) return
      if (current === name) { controllers.get(name)?.focus?.(); return }
      hide(); options.resetArchive()
      let page = controllers.get(name)
      if (!page) { page = options.pages[name].mount(); controllers.set(name, page) }
      else if (name === 'search') page.refresh?.()
      if (name === 'user') page.refresh?.()
      window.clearTimeout(timers.get(name)); timers.delete(name)
      current = name
      page.element.hidden = false; page.element.inert = false
      mark(name); options.changed(name)
      if (options.reduced) root.dataset.view = name
      else {
        window.cancelAnimationFrame(frame)
        frame = window.requestAnimationFrame(() => { frame = 0; if (!disposed && current === name) root.dataset.view = name })
      }
      page.focus?.()
    },
    hide,
    destroy() {
      if (disposed) return
      disposed = true; window.cancelAnimationFrame(frame)
      timers.forEach(timer => window.clearTimeout(timer)); timers.clear()
      controllers.forEach(page => page.destroy()); controllers.clear()
    },
  }
}
