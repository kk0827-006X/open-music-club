import { uiIcon, uiIcons } from './ui-icons.ts'
import type { SearchItem } from './music-search.ts'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

export function createQueuePanelMarkup() {
  return `<aside id="player-queue-panel" class="player-queue-panel" data-player-queue-panel hidden aria-label="播放队列"><header><strong>PLAY QUEUE / 播放队列</strong><button type="button" data-queue-clear aria-label="清空队列" title="清空队列">${uiIcons.trash}</button></header><ol data-queue-items aria-label="歌曲顺序"></ol><p data-queue-empty>队列为空。可从音乐库或搜索结果加入歌曲。</p><p class="sr-only" data-queue-order-status role="status"></p></aside>`
}

export function createQueueItemsMarkup(items: readonly SearchItem[], activeKey?: string, likes = new Map<string, boolean>()) {
  return items.map((item, index) => {
    const key = escapeHtml(item.key), title = escapeHtml(item.title), liked = likes.get(item.key) === true
    return `<li data-queue-key="${key}"${item.key === activeKey ? ' class="is-active"' : ''}>
      <button class="queue-drag-handle" type="button" data-queue-drag="${key}" aria-label="拖动 ${title} 排序" title="拖动排序，也可按上下方向键调整">${String(index + 1).padStart(2, '0')}</button>
      <img src="${escapeHtml(item.coverUrl)}" alt="" draggable="false" />
      <div class="queue-copy"><strong>${title}</strong><small>${escapeHtml(item.artist)} / ${item.source === 'local' ? 'LOCAL' : 'NETEASE'}</small></div>
      <div class="queue-actions"><button type="button" data-queue-play="${key}" aria-label="播放 ${title}" title="播放">${uiIcons.play}</button><button type="button" data-queue-save="${key}" aria-label="将 ${title} 加入歌单" title="加入歌单">${uiIcons.playlistAdd}</button><button type="button" data-queue-like="${key}" aria-pressed="${liked}" aria-label="${liked ? '取消收藏' : '收藏'} ${title}" title="${liked ? '取消收藏' : '收藏'}"${likes.has(item.key) ? '' : ' disabled'}>${uiIcon('heart', liked)}</button><button type="button" data-queue-remove="${key}" aria-label="移除 ${title}" title="移除">${uiIcons.close}</button></div>
    </li>`
  }).join('')
}

export function queueDropIndex(center: number, centers: readonly number[]) {
  if (!centers.length) return 0
  return centers.reduce((best, value, index) => Math.abs(value - center) < Math.abs(centers[best] - center) ? index : best, 0)
}

export function bindQueueOutsideClose(panel: HTMLElement, toggle: () => HTMLElement | null, close: () => void) {
  const outside = (event: Event) => {
    const target = event.target as Node | null
    if (!panel.hidden && target && !panel.contains(target) && !toggle()?.contains(target)) close()
  }
  // 只关闭浮层，不阻止同一次点击触发页面原有按钮。
  panel.ownerDocument.addEventListener('pointerdown', outside, true)
  return () => panel.ownerDocument.removeEventListener('pointerdown', outside, true)
}

type QueuePanelOptions = {
  reduced: boolean;
  toggle: () => HTMLElement | null;
  close: () => void;
  reorder: (key: string, index: number) => void;
}

export function mountQueuePanel(panel: HTMLElement, options: QueuePanelOptions) {
  const list = panel.querySelector<HTMLOListElement>('[data-queue-items]')!
  const unbindOutside = bindQueueOutsideClose(panel, options.toggle, options.close)
  const animations = new Map<HTMLElement, Animation>()
  let frame = 0, suppressClick = false, clickTimer = 0
  let drag: {
    row: HTMLElement; pointer: number; startY: number; y: number; scroll: number;
    index: number; destination: number; started: boolean; delta: number;
    rows: HTMLElement[]; centers: number[]; height: number;
  } | null = null

  const animate = (row: HTMLElement, from: string, to: string, jelly = true) => {
    animations.get(row)?.cancel()
    if (options.reduced) return
    const animation = row.animate(jelly ? [
      { transform: from }, { transform: `${to} scale(.98,1.04)`, offset: .55 },
      { transform: `${to} scale(1.01,.985)`, offset: .8 }, { transform: to },
    ] : [{ transform: from }, { transform: to }], { duration: 420, easing: 'cubic-bezier(.22,.7,.28,1)' })
    animations.set(row, animation)
    animation.onfinish = () => { if (animations.get(row) === animation) animations.delete(row) }
  }
  const cancelDrag = () => {
    cancelAnimationFrame(frame); frame = 0
    const current = drag; drag = null
    if (current && list.hasPointerCapture(current.pointer)) list.releasePointerCapture(current.pointer)
    current?.rows.forEach(row => { row.style.transform = ''; row.classList.remove('is-dragging') })
    animations.forEach(animation => animation.cancel()); animations.clear()
    list.classList.remove('is-dragging')
  }
  const paint = () => {
    frame = 0
    if (!drag?.started) return
    const current = drag
    const bounds = panel.getBoundingClientRect()
    // 长队列靠近边缘时缓慢滚动；循环仅在拖动期间存在。
    const scrollStep = current.y < bounds.top + 64 ? -6 : current.y > bounds.bottom - 32 ? 6 : 0
    panel.scrollTop += scrollStep
    const delta = current.y - current.startY + panel.scrollTop - current.scroll
    current.delta = Math.max(current.centers[0] - current.centers[current.index],
      Math.min(current.centers.at(-1)! - current.centers[current.index], delta))
    const next = queueDropIndex(current.centers[current.index] + current.delta, current.centers)
    current.row.style.transform = `translateY(${current.delta}px)${options.reduced ? '' : ' scale(1.02)'}`
    if (next !== current.destination) {
      current.rows.forEach((row, index) => {
        if (index === current.index) return
        const shift = next > current.index && index > current.index && index <= next ? -current.height
          : next < current.index && index < current.index && index >= next ? current.height : 0
        const to = `translateY(${shift}px)`
        if (row.style.transform === to) return
        const from = getComputedStyle(row).transform
        row.style.transform = to
        animate(row, from === 'none' ? 'translateY(0px)' : from, to)
      })
      current.destination = next
    }
    if (scrollStep) frame = requestAnimationFrame(paint)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag || !(event.target instanceof Element)) return
    if (event.target.closest('button:not([data-queue-drag])')) return
    const row = event.target.closest<HTMLElement>('[data-queue-key]')
    if (!row) return
    animations.forEach(animation => animation.cancel()); animations.clear()
    const rows = [...list.querySelectorAll<HTMLElement>('[data-queue-key]')]
    const bounds = rows.map(entry => entry.getBoundingClientRect())
    const index = rows.indexOf(row)
    drag = { row, rows, centers: bounds.map(rect => rect.top + rect.height / 2), index, destination: index,
      height: bounds[index].height, pointer: event.pointerId, startY: event.clientY, y: event.clientY,
      scroll: panel.scrollTop, started: false, delta: 0 }
    suppressClick = false
    list.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return
    drag.y = event.clientY
    if (!drag.started && Math.abs(drag.y - drag.startY) < 5) return
    event.preventDefault()
    drag.started = true
    drag.row.classList.add('is-dragging'); list.classList.add('is-dragging')
    if (!frame) frame = requestAnimationFrame(paint)
  }
  const up = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') { cancelDrag(); return }
    if (!drag.started) { cancelDrag(); return }
    // 在松手前处理最后一个位置，再一次性提交顺序，避免每帧重建列表。
    cancelAnimationFrame(frame); frame = 0; drag.y = event.clientY; paint()
    const current = drag
    const offsets = new Map(current.rows.map(row => [row.dataset.queueKey!, row.getBoundingClientRect().top]))
    const key = current.row.dataset.queueKey!
    cancelDrag(); suppressClick = true
    window.clearTimeout(clickTimer)
    clickTimer = window.setTimeout(() => { suppressClick = false }, 0)
    options.reorder(key, current.destination)
    list.querySelectorAll<HTMLElement>('[data-queue-key]').forEach(row => {
      const previous = offsets.get(row.dataset.queueKey!)
      if (previous !== undefined) animate(row, `translateY(${previous - row.getBoundingClientRect().top}px)`, 'translateY(0px)')
    })
  }
  const click = (event: MouseEvent) => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation() }
  }
  const keyboard = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element) || !event.target.matches('[data-queue-drag]')) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault(); event.stopPropagation()
    const row = event.target.closest<HTMLElement>('[data-queue-key]')!
    const rows = [...list.querySelectorAll<HTMLElement>('[data-queue-key]')]
    const next = Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (event.key === 'ArrowUp' ? -1 : 1)))
    const key = row.dataset.queueKey!
    options.reorder(key, next)
    Array.from(list.querySelectorAll<HTMLElement>('[data-queue-drag]')).find(button => button.dataset.queueDrag === key)?.focus()
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); options.close(); options.toggle()?.focus()
  }
  panel.addEventListener('keydown', escape)
  list.addEventListener('pointerdown', down)
  list.addEventListener('pointermove', move)
  list.addEventListener('pointerup', up)
  list.addEventListener('pointercancel', up)
  list.addEventListener('lostpointercapture', up)
  list.addEventListener('click', click, true)
  list.addEventListener('keydown', keyboard)
  return {
    cancelDrag,
    destroy() {
      cancelDrag(); unbindOutside()
      window.clearTimeout(clickTimer)
      panel.removeEventListener('keydown', escape)
      list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move)
      list.removeEventListener('pointerup', up); list.removeEventListener('pointercancel', up)
      list.removeEventListener('lostpointercapture', up)
      list.removeEventListener('click', click, true); list.removeEventListener('keydown', keyboard)
    },
  }
}
