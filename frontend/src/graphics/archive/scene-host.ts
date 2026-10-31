import type { ArchiveCell, ArchiveNavigation } from '../../rhine/archive-loop.ts'
import { getThemeState, subscribeTheme } from '../../shared/theme.ts'
export type ArchiveEntryPhase = 'loading' | 'entering' | 'settling' | 'ready' | 'failed'
export interface ArchiveSceneController {
  load(): Promise<void>
  setReduced(reduced: boolean): void
  setTheme?(dark: boolean, immediate?: boolean): void
  setMode(mode: 'hidden' | 'archive' | 'detail'): void
  select(index: number, navigation?: ArchiveNavigation): void
  resize(): void
  update(seconds: number, cinematic?: { reveal: number; lift: number; zoom: number; time: number }): void
  prepareEntry?(): Promise<void>
  finishOpening?(immediate?: boolean): void
  setOpeningProgress?(progress: number): void
  finishDecryption(): void
  readonly detailVisibility: number
  onCoverUpdate?: () => void
  onSelect?: (index: number, cell?: ArchiveCell) => void
  onNavigate?: (axis: 'row' | 'lane', direction: number) => void
  dispose(): void
}
// 只有这个宿主持有档案 RAF；场景负责模拟与渲染，不负责页面导航。
export function mountArchiveScene(container: HTMLElement, options: {
  entry?: boolean; onEntryPhase?(phase: ArchiveEntryPhase): void
  reduced: boolean; initialRecord: number; covers: readonly string[]
  loadScene?: () => Promise<ArchiveSceneController>
  afterUpdate(visibility: number, now: number): boolean
  onSelect(index: number, cell?: ArchiveCell): void
  onNavigate(axis: 'row' | 'lane', direction: number): void
}) {
  let frame = 0, visible = true, disposed = false, ready = false
  let scene: ArchiveSceneController | null = null
  let phase: ArchiveEntryPhase = 'loading', elapsed = 0, lastFrame: number | null = null
  let reduced = options.reduced, skipped = false
  const changePhase = (next: ArchiveEntryPhase) => {
    if (phase === next || disposed) return
    phase = next; options.onEntryPhase?.(next)
  }
  const draw = (now: number) => {
    if (!scene) return
    const cinematic = phase === 'entering' ? {
      time: 21.9 + elapsed, reveal: Math.min(1, elapsed / .4), lift: 0, zoom: 0,
    } : undefined
    scene.update(now / 1000, cinematic)
  }
  const stop = () => { window.cancelAnimationFrame(frame); frame = 0; lastFrame = null }
  const animate = (now: number) => {
    frame = 0
    if (disposed || !visible || document.hidden || !ready || !scene) return
    const delta = lastFrame === null ? 0 : Math.max(0, (now - lastFrame) / 1000)
    lastFrame = now
    if (phase === 'entering' || phase === 'settling') elapsed += delta
    if (phase === 'entering' && elapsed >= 3) {
      // 停在 24.9 秒，排除原项目 25.05 秒起的特定档案聚焦及后续抽取。
      if (scene.finishOpening) scene.finishOpening(); else scene.setMode('archive')
      elapsed = 0; changePhase('settling')
    }
    if (phase === 'settling') {
      scene.setOpeningProgress?.(Math.min(1, elapsed / 1.6))
      if (elapsed >= 1.6) changePhase('ready')
    }
    draw(now)
    if (phase === 'ready' && !options.afterUpdate(scene.detailVisibility, now)) {
      scene.finishDecryption(); scene.update(now / 1000); return
    }
    frame = window.requestAnimationFrame(animate)
  }
  const wake = () => {
    if (!disposed && visible && !document.hidden && ready && !frame) frame = window.requestAnimationFrame(animate)
  }
  const resize = () => { if (!disposed) { scene?.resize(); wake() } }
  const visibility = () => { if (document.hidden) stop(); else wake() }
  // 只更新原有材质和环境，不重建模型、渲染器或播放会话。
  const applyTheme = () => {
    scene?.setTheme?.(getThemeState().resolved === 'dark', true)
    // 弹窗后方的画布也要即时换色；只补画一次，不恢复隐藏页的动画循环。
    if (ready && !visible && !document.hidden) draw(performance.now())
    wake()
  }
  const unsubscribeTheme = subscribeTheme(applyTheme)
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', visibility)
  const load = options.loadScene ?? (async () => {
    const { ArchiveScene } = await import('../../rhine/scene.ts')
    return new ArchiveScene(container, undefined, undefined, undefined, options.covers)
  })
  void load().then(async next => {
    if (disposed) { next.dispose(); return }
    scene = next; next.onCoverUpdate = wake; next.setReduced(reduced)
    await next.load()
    if (disposed) return
    next.select(options.initialRecord); next.resize()
    if (options.entry && !reduced) await next.prepareEntry?.()
    if (disposed) return
    ready = true
    if (options.entry && !reduced && !skipped) { next.setMode('hidden'); changePhase('entering') }
    else { if (options.entry && next.finishOpening) next.finishOpening(true); else next.setMode('archive'); changePhase('ready') }
    applyTheme()
    next.onSelect = (index, cell) => { if (phase === 'ready' && visible) options.onSelect(index, cell) }
    next.onNavigate = (axis, direction) => { if (phase === 'ready' && visible) options.onNavigate(axis, direction) }
    wake()
  }).catch(() => {
    scene?.dispose(); scene = null
    changePhase('failed')
    if (!disposed) container.textContent = '三维档案墙暂时无法加载，请刷新页面重试。'
  })
  const skipEntry = () => {
    skipped = true
    if (disposed || phase === 'ready') return
    if (!ready || !scene) { changePhase('ready'); return }
    if (scene.finishOpening) scene.finishOpening(true); else scene.setMode('archive')
    elapsed = 0; lastFrame = null
    changePhase('ready'); wake()
  }
  return {
    get ready() { return ready && phase === 'ready' },
    get entryPhase() { return phase }, wake,
    setReduced(value: boolean) { reduced = value; scene?.setReduced(value); if (value && options.entry) skipEntry(); wake() },
    setVisible(value: boolean) { visible = value; if (!value) stop(); else wake() },
    setMode(mode: 'archive' | 'detail') { scene?.setMode(mode); wake() },
    select(index: number, navigation?: ArchiveNavigation) { if (ready && phase === 'ready') scene?.select(index, navigation) },
    destroy() {
      if (disposed) return
      disposed = true; stop(); scene?.dispose(); scene = null
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility)
      unsubscribeTheme()
    },
  }
}
