import type { ArchiveCell, ArchiveNavigation } from '../../rhine/archive-loop.ts'
export interface ArchiveSceneController {
  load(): Promise<void>
  setReduced(reduced: boolean): void
  setMode(mode: 'archive' | 'detail'): void
  select(index: number, navigation?: ArchiveNavigation): void
  resize(): void
  update(seconds: number): void
  finishDecryption(): void
  readonly detailVisibility: number
  onCoverUpdate?: () => void
  onSelect?: (index: number, cell?: ArchiveCell) => void
  onNavigate?: (axis: 'row' | 'lane', direction: number) => void
  dispose(): void
}
// 只有这个宿主持有档案 RAF；场景负责模拟与渲染，不负责页面导航。
export function mountArchiveScene(container: HTMLElement, options: {
  reduced: boolean; initialRecord: number; covers: readonly string[]
  loadScene?: () => Promise<ArchiveSceneController>
  afterUpdate(visibility: number, now: number): boolean
  onSelect(index: number, cell?: ArchiveCell): void
  onNavigate(axis: 'row' | 'lane', direction: number): void
}) {
  let frame = 0, visible = true, disposed = false, ready = false
  let scene: ArchiveSceneController | null = null
  const stop = () => { window.cancelAnimationFrame(frame); frame = 0 }
  const animate = (now: number) => {
    frame = 0
    if (disposed || !visible || document.hidden || !ready || !scene) return
    scene.update(now / 1000)
    if (!options.afterUpdate(scene.detailVisibility, now)) {
      scene.finishDecryption(); scene.update(now / 1000); return
    }
    frame = window.requestAnimationFrame(animate)
  }
  const wake = () => {
    if (!disposed && visible && !document.hidden && ready && !frame) frame = window.requestAnimationFrame(animate)
  }
  const resize = () => { if (!disposed) { scene?.resize(); wake() } }
  const visibility = () => { if (document.hidden) stop(); else wake() }
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', visibility)
  const load = options.loadScene ?? (async () => {
    const { ArchiveScene } = await import('../../rhine/scene.ts')
    return new ArchiveScene(container, undefined, undefined, undefined, options.covers)
  })
  void load().then(async next => {
    if (disposed) { next.dispose(); return }
    scene = next; next.onCoverUpdate = wake; next.setReduced(options.reduced)
    await next.load()
    if (disposed) return
    ready = true; next.setMode('archive')
    next.onSelect = options.onSelect; next.onNavigate = options.onNavigate
    next.select(options.initialRecord); next.resize(); wake()
  }).catch(() => {
    scene?.dispose(); scene = null
    if (!disposed) container.textContent = '三维档案墙暂时无法加载，请刷新页面重试。'
  })
  return {
    get ready() { return ready }, wake,
    setVisible(value: boolean) { visible = value; if (!value) stop(); else wake() },
    setMode(mode: 'archive' | 'detail') { scene?.setMode(mode); wake() },
    select(index: number, navigation?: ArchiveNavigation) { if (ready) scene?.select(index, navigation) },
    destroy() {
      if (disposed) return
      disposed = true; stop(); scene?.dispose(); scene = null
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility)
    },
  }
}
