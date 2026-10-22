import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { motion, Reorder, useDragControls } from 'motion/react'
import type { SearchItem } from '../../shared/music.ts'
import { Icon } from '../../shared/react/ui.tsx'

const FALLBACK_COVER = '/images/album-placeholder-01.svg'

function replaceBrokenCover(event: { currentTarget: HTMLImageElement }) {
  const image = event.currentTarget
  if (!image.src.endsWith('album-placeholder-01.svg')) image.src = FALLBACK_COVER
}

// cancel() 不派发迟到的 onDragEnd，防止取消后马上重拖同一曲目时误提交。
type DragControlsLike = { cancel(): void }

type DragPrepareInit = {
  key: string
  pointerId: number
  x: number
  y: number
  element: HTMLElement
  captureTarget: HTMLElement
  controls: DragControlsLike
}

type DragPrepare = DragPrepareInit & {
  released: boolean
  canceled: boolean
  detach(): void
}

type DragSession = {
  key: string
  pointerId: number
  pointer: { x: number; y: number }
  element: HTMLElement
  captureTarget: HTMLElement
  controls: DragControlsLike
  itemsSignature: string
  released: boolean
  detach(): void
}

function releasePointer(element: HTMLElement | null, pointerId: number | null) {
  if (!element || pointerId === null) return
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // 指针已经失效时浏览器会抛 NotFoundError，此处无需再处理。
  }
}

function queueSignature(items: readonly SearchItem[]) {
  return items.map((item) => item.key).join('\u0000')
}

export interface QueuePanelProps {
  open: boolean
  items: readonly SearchItem[]
  activeKey?: string
  reduced: boolean
  likes: ReadonlyMap<string, boolean>
  pendingLikes: ReadonlySet<string>
  orderStatus: string
  onClose(): void
  onFocusToggle(): void
  onClear(): void
  onPlay(item: SearchItem): void
  onRemove(item: SearchItem): void
  onSave(item: SearchItem): void
  onLike(item: SearchItem): void
  onReorder(items: SearchItem[], movedKey?: string): void
}

type QueueRowProps = {
  item: SearchItem
  index: number
  activeKey?: string
  reduced: boolean
  liked: boolean
  likeKnown: boolean
  pending: boolean
  dragging: boolean
  getPanel(): HTMLElement | null
  items: readonly SearchItem[]
  onDragPrepare(prepare: DragPrepareInit): void
  onDragStart(key: string, point?: { x: number; y: number }): void
  onDragEnd(key: string): void
  onPlay(item: SearchItem): void
  onRemove(item: SearchItem): void
  onSave(item: SearchItem): void
  onLike(item: SearchItem): void
  onReorder(items: SearchItem[], movedKey?: string): void
}

function QueueRow(props: QueueRowProps) {
  const controls = useDragControls()
  const focusFrame = useRef(0)
  const {
    item, index, activeKey, reduced, liked, likeKnown, pending, dragging,
    getPanel, items, onDragPrepare, onDragStart, onDragEnd,
    onPlay, onRemove, onSave, onLike, onReorder,
  } = props
  const className = [
    item.key === activeKey ? 'is-active' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ') || undefined
  const transition = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 520, damping: 28, mass: 0.62 }

  // 组件可能在焦点回填的两帧之间被关闭，卸载时取消待执行 frame。
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), [])

  const moveByKeyboard = (direction: -1 | 1) => {
    const current = items.findIndex((entry) => entry.key === item.key)
    if (current < 0) return
    const target = Math.max(0, Math.min(items.length - 1, current + direction))
    if (target === current) return
    const next = [...items]
    const [moved] = next.splice(current, 1)
    next.splice(target, 0, moved)
    // 键盘排序仍然立即提交一次，不走拖动的 draft/onDragEnd 链路。
    onReorder(next, item.key)
    cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = 0
        const panel = getPanel()
        // 两帧之间面板可能已关闭；hidden 时不把焦点抢回不可见手柄。
        if (!panel || panel.hidden) return
        const handle = Array.from(panel.querySelectorAll<HTMLElement>('[data-queue-drag]') ?? [])
          .find((button) => button.dataset.queueDrag === item.key)
        handle?.focus()
      })
    })
  }

  const keyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    moveByKeyboard(event.key === 'ArrowUp' ? -1 : 1)
  }

  // 保持原来的整行拖拽：动作按钮和输入框之外的位置都能开始拖动。
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return
    const target = event.target
    if (target instanceof Element && target.closest('button:not([data-queue-drag]), input, select, textarea')) return
    onDragPrepare({
      key: item.key,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      element: event.currentTarget,
      captureTarget: event.target instanceof HTMLElement ? event.target : event.currentTarget,
      controls,
    })
    controls.start(event)
  }

  return (
    <Reorder.Item
      as="li"
      value={item}
      data-queue-key={item.key}
      className={className}
      dragListener={false}
      dragControls={controls}
      layout
      transition={transition}
      whileDrag={reduced ? undefined : { scale: 1.02 }}
      onPointerDown={startDrag}
      onDragStart={(event) => {
        // Motion 的 onDragStart 在越过阈值后的 frame 中触发，此时指针可能已不再是按下点。
        const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : undefined
        onDragStart(item.key, point)
      }}
      onDragEnd={() => onDragEnd(item.key)}
    >
      <button
        className="queue-drag-handle"
        type="button"
        data-queue-drag={item.key}
        aria-label={`拖动 ${item.title} 排序`}
        title="拖动排序，也可按上下方向键调整"
        onKeyDown={keyboard}
      >
        {String(index + 1).padStart(2, '0')}
      </button>
      <img src={item.coverUrl} alt="" draggable={false} onError={replaceBrokenCover} />
      <div className="queue-copy">
        <strong>{item.title}</strong>
        <small>{item.artist} / {item.source === 'local' ? 'LOCAL' : 'NETEASE'}</small>
      </div>
      <div className="queue-actions">
        <button
          type="button"
          data-queue-play={item.key}
          aria-label={`播放 ${item.title}`}
          title="播放"
          onClick={() => onPlay(item)}
        >
          <Icon name="play" />
        </button>
        <button
          type="button"
          data-queue-save={item.key}
          aria-label={`将 ${item.title} 加入歌单`}
          title="加入歌单"
          onClick={() => onSave(item)}
        >
          <Icon name="playlistAdd" />
        </button>
        <button
          type="button"
          data-queue-like={item.key}
          aria-pressed={liked}
          aria-label={`${liked ? '取消收藏' : '收藏'} ${item.title}`}
          title={liked ? '取消收藏' : '收藏'}
          disabled={!likeKnown || pending}
          onClick={() => onLike(item)}
        >
          <Icon name="heart" filled={liked} />
        </button>
        <button
          type="button"
          data-queue-remove={item.key}
          aria-label={`移除 ${item.title}`}
          title="移除"
          onClick={() => onRemove(item)}
        >
          <Icon name="close" />
        </button>
      </div>
    </Reorder.Item>
  )
}

// 队列拖拽由 Motion Reorder 负责碰撞与弹簧回位；本组件不再自造逐帧拖拽引擎。
// 拖动期间只更新本地 draft；松手（onDragEnd）才向父组件提交一次真实队列顺序与持久化。
export const QueuePanel = memo(forwardRef<HTMLElement, QueuePanelProps>(function QueuePanel(props, ref) {
  const {
    open, items, activeKey, reduced, likes, pendingLikes, orderStatus,
    onClose, onFocusToggle, onClear, onPlay, onRemove, onSave, onLike, onReorder,
  } = props
  const localRef = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [draft, setDraftState] = useState<SearchItem[]>(() => [...items])
  const draftRef = useRef<SearchItem[]>(draft)
  draftRef.current = draft
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const draggingKeyRef = useRef<string | null>(null)
  const preparedRef = useRef<DragPrepare | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onFocusToggleRef = useRef(onFocusToggle)
  onFocusToggleRef.current = onFocusToggle

  const assignRef = useCallback((node: HTMLElement | null) => {
    localRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as { current: HTMLElement | null }).current = node
  }, [ref])

  const updateDraft = useCallback((next: SearchItem[]) => {
    draftRef.current = next
    setDraftState(next)
  }, [])

  // 结束当前拖动会话，但不在结束过程中触发父组件提交。
  const endSession = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    preparedRef.current = null
    if (!session) return false
    session.detach()
    // 先清空 session 再停止 Motion 拖动；即使 stop() 迟到的 onDragEnd 也不会提交。
    session.controls.cancel()
    releasePointer(session.element, session.pointerId)
    releasePointer(session.captureTarget, session.pointerId)
    return true
  }, [])

  const cancelDrag = useCallback(() => {
    const prepared = preparedRef.current
    const hadSession = endSession()
    preparedRef.current = null
    // 指针已按下、Motion 尚未触发 onDragStart 时也要停掉它的 pan session。
    if (prepared) {
      prepared.detach()
      prepared.controls.cancel()
      releasePointer(prepared.element, prepared.pointerId)
      releasePointer(prepared.captureTarget, prepared.pointerId)
    }
    if (draggingKeyRef.current !== null || hadSession) {
      draggingKeyRef.current = null
      setDraggingKey(null)
    }
  }, [endSession])

  // 拖动开始：用当前队列生成 draft，并保留会话直到松手或取消。
  const beginDrag = useCallback((key: string, point?: { x: number; y: number }) => {
    if (!open) {
      cancelDrag()
      return
    }
    const prepared = preparedRef.current
    if (!prepared || prepared.key !== key) return
    prepared.detach()
    preparedRef.current = null
    // 在 Motion 的 onDragStart 到达前已经 pointercancel/lostpointercapture：绝不开始可提交会话。
    if (prepared.canceled) {
      prepared.controls.cancel()
      releasePointer(prepared.element, prepared.pointerId)
      releasePointer(prepared.captureTarget, prepared.pointerId)
      return
    }
    if (sessionRef.current) cancelDrag()
    const session: DragSession = {
      key,
      pointerId: prepared.pointerId,
      pointer: point ?? { x: prepared.x, y: prepared.y },
      element: prepared.element,
      captureTarget: prepared.captureTarget,
      controls: prepared.controls,
      itemsSignature: queueSignature(itemsRef.current),
      released: prepared.released,
      detach: () => undefined,
    }
    const matches = (event: PointerEvent) => event.pointerId === session.pointerId
    const move = (event: PointerEvent) => {
      if (!matches(event)) return
      session.pointer = { x: event.clientX, y: event.clientY }
    }
    // 正常松手交给 Motion 的 onDragEnd 提交一次；这里只标记，避免 lostpointercapture 误取消。
    const up = (event: PointerEvent) => {
      if (matches(event)) session.released = true
    }
    const cancel = (event: PointerEvent) => {
      if (matches(event)) cancelDrag()
    }
    const lost = (event: PointerEvent) => {
      if (matches(event) && !session.released) cancelDrag()
    }
    // 拖动中焦点可能不在面板内；用拖动期临时监听保证 Escape 一定能取消。
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      cancelDrag()
      onCloseRef.current()
      onFocusToggleRef.current()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('lostpointercapture', lost, true)
    window.addEventListener('keydown', escape, true)
    session.detach = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('lostpointercapture', lost, true)
      window.removeEventListener('keydown', escape, true)
    }
    sessionRef.current = session
    preparedRef.current = null
    draggingKeyRef.current = key
    // 先写 draft 再打开拖动态，避免未批处理时短暂显示上一次拖动留下的旧顺序。
    updateDraft([...itemsRef.current])
    setDraggingKey(key)
  }, [cancelDrag, open, updateDraft])

  // 松手提交：只有这里会把 draft 顺序写回真实队列与持久化。
  const finishDrag = useCallback((key: string) => {
    const session = sessionRef.current
    // 已取消/已替换的会话即使迟到触发 onDragEnd，也不允许再提交。
    if (!session || session.key !== key || !session.released) return
    // 面板已关闭或拖动期间队列被外部改动时，按取消处理，绝不覆盖最新队列。
    if (!openRef.current || queueSignature(itemsRef.current) !== session.itemsSignature) {
      cancelDrag()
      return
    }
    sessionRef.current = null
    preparedRef.current = null
    draggingKeyRef.current = null
    session.detach()
    releasePointer(session.element, session.pointerId)
    releasePointer(session.captureTarget, session.pointerId)
    const finalItems = [...draftRef.current]
    // 先提交父队列再关闭拖动态：未批处理时也不会先显示旧 props 顺序再跳一下。
    onReorderRef.current(finalItems, session.key)
    setDraggingKey(null)
  }, [cancelDrag])

  const handleReorder = useCallback((next: SearchItem[]) => {
    // 只更新本地 draft；拖动过程中绝不清空 draggedKey，也绝不提前提交。
    updateDraft(next)
  }, [updateDraft])

  const prepareDrag = useCallback((init: DragPrepareInit) => {
    // 上一次点击留下的准备态先解绑，始终只保留一个待判定指针。
    preparedRef.current?.detach()
    const prepare: DragPrepare = {
      ...init,
      released: false,
      canceled: false,
      detach: () => undefined,
    }
    const matches = (event: PointerEvent) => event.pointerId === prepare.pointerId
    // Motion 的 onDragStart 延后到阈值后的 frame 才触发；这里提前记录 release/cancel，
    // 避免同一帧内快速松手或取消时创建出错误的提交会话。
    const up = (event: PointerEvent) => {
      if (!matches(event)) return
      prepare.released = true
      // Motion 的 onDragStart 可能在一帧后才到；保留 released 标记即可，先解绑监听。
      prepare.detach()
    }
    const cancel = (event: PointerEvent) => {
      if (!matches(event)) return
      prepare.canceled = true
      prepare.detach()
    }
    const lost = (event: PointerEvent) => {
      if (!matches(event) || prepare.released) return
      prepare.canceled = true
      prepare.detach()
    }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('lostpointercapture', lost, true)
    prepare.detach = () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('lostpointercapture', lost, true)
    }
    preparedRef.current = prepare
  }, [])

  // 队列内容/顺序在拖动之外发生变化时同步 draft 基准；若变化发生在拖动中，
  // 按原 panel.ts 的行为取消本次拖动，避免松手后覆盖新队列。
  const itemsSignature = queueSignature(items)
  useEffect(() => {
    if (sessionRef.current) {
      cancelDrag()
      return
    }
    draftRef.current = [...itemsRef.current]
  }, [itemsSignature, cancelDrag])

  // 面板关闭或组件卸载时，取消拖动、释放捕获并丢弃尚未提交的 draft。
  useEffect(() => {
    if (open) return
    cancelDrag()
  }, [open, cancelDrag])

  useEffect(() => () => {
    const session = sessionRef.current
    const prepared = preparedRef.current
    sessionRef.current = null
    preparedRef.current = null
    draggingKeyRef.current = null
    if (session) {
      session.detach()
      session.controls.cancel()
      releasePointer(session.element, session.pointerId)
      releasePointer(session.captureTarget, session.pointerId)
    } else if (prepared) {
      // 已按下但 onDragStart 还没到：卸载时也要停掉 Motion 的 pan session。
      prepared.detach()
      prepared.controls.cancel()
      releasePointer(prepared.element, prepared.pointerId)
      releasePointer(prepared.captureTarget, prepared.pointerId)
    }
  }, [])

  // 边缘滚动仅由 Motion Reorder 内建实现负责，不能再叠加第二个逐帧滚动器。

  const keyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    // Escape 同时是拖动取消：不提交、释放捕获并清理会话，然后再关闭面板。
    cancelDrag()
    onClose()
    onFocusToggle()
  }

  // 拖动期间给 Reorder.Group 使用 draft；其余时间始终直接使用最新 props，避免队列原地增删后显示陈旧副本。
  const displayedItems = draggingKey === null ? [...items] : draft

  return (
    <motion.aside
      ref={assignRef}
      id="player-queue-panel"
      className="player-queue-panel"
      data-player-queue-panel
      hidden={!open}
      aria-label="播放队列"
      layoutScroll
      onKeyDown={keyboard}
    >
      <header>
        <strong>PLAY QUEUE / 播放队列</strong>
        <button
          type="button"
          data-queue-clear
          aria-label="清空队列"
          title="清空队列"
          disabled={items.length === 0}
          onClick={onClear}
        >
          <Icon name="trash" />
        </button>
      </header>
      <Reorder.Group
        as="ol"
        axis="y"
        values={displayedItems}
        onReorder={handleReorder}
        data-queue-items
        aria-label="歌曲顺序"
        className={draggingKey ? 'is-dragging' : undefined}
      >
        {displayedItems.map((item, index) => (
          <QueueRow
            key={item.key}
            item={item}
            index={index}
            activeKey={activeKey}
            reduced={reduced}
            liked={likes.get(item.key) === true}
            likeKnown={likes.has(item.key)}
            pending={pendingLikes.has(item.key)}
            dragging={draggingKey === item.key}
            getPanel={() => localRef.current}
            items={displayedItems}
            onDragPrepare={prepareDrag}
            onDragStart={beginDrag}
            onDragEnd={finishDrag}
            onPlay={onPlay}
            onRemove={onRemove}
            onSave={onSave}
            onLike={onLike}
            onReorder={onReorder}
          />
        ))}
      </Reorder.Group>
      <p data-queue-empty hidden={items.length > 0}>队列为空。可从音乐库或搜索结果加入歌曲。</p>
      <p className="sr-only" data-queue-order-status role="status">{orderStatus}</p>
    </motion.aside>
  )
}))

export default QueuePanel
