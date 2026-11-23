import { forwardRef, memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, Reorder } from 'motion/react';
import type { SearchItem } from '../../shared/music.ts';
import { Icon } from '../../shared/react/ui.tsx';
import { QueueRow, revealQueueItem, type DragPrepareInit } from './QueueRow.tsx';

type DragPrepare = DragPrepareInit & {
  released: boolean;
  canceled: boolean;
  detach(): void;
};

type DragSession = {
  key: string;
  pointerId: number;
  pointer: { x: number; y: number };
  element: HTMLElement;
  captureTarget: HTMLElement;
  controls: DragPrepareInit['controls'];
  itemsSignature: string;
  released: boolean;
  detach(): void;
};

function releasePointer(element: HTMLElement | null, pointerId: number | null) {
  if (!element || pointerId === null) return;
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // 指针已经失效时浏览器会抛 NotFoundError，此处无需再处理。
  }
}

function queueSignature(items: readonly SearchItem[]) {
  return items.map((item) => item.key).join('\u0000');
}

export interface QueuePanelProps {
  mode?: 'queue' | 'search';
  message?: string;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?(): void;
  open: boolean;
  immersive?: boolean;
  items: readonly SearchItem[];
  activeKey?: string;
  reduced: boolean;
  likes: ReadonlyMap<string, boolean>;
  pendingLikes: ReadonlySet<string>;
  orderStatus: string;
  onClose(): void;
  onFocusToggle(): void;
  onClear(): void;
  onPlay(item: SearchItem): void;
  onOpenAlbum?(item: SearchItem): void;
  onRemove(item: SearchItem): void;
  onSave(item: SearchItem): void;
  onLike(item: SearchItem): void;
  onReorder(items: SearchItem[], movedKey?: string): void;
}

export const QueuePanel = memo(
  forwardRef<HTMLElement, QueuePanelProps>(function QueuePanel(props, ref) {
    const {
      open,
      immersive = false,
      items,
      activeKey,
      reduced,
      likes,
      pendingLikes,
      orderStatus,
      onClose,
      onFocusToggle,
      onClear,
      onPlay,
      onRemove,
      onSave,
      onLike,
      onReorder,
    } = props;
    const localRef = useRef<HTMLElement | null>(null);
    const openRef = useRef(open);
    openRef.current = open;
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const [draft, setDraftState] = useState<SearchItem[]>(() => [...items]);
    const draftRef = useRef<SearchItem[]>(draft);
    draftRef.current = draft;
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const draggingKeyRef = useRef<string | null>(null);
    const preparedRef = useRef<DragPrepare | null>(null);
    const sessionRef = useRef<DragSession | null>(null);
    const onReorderRef = useRef(onReorder);
    onReorderRef.current = onReorder;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const onFocusToggleRef = useRef(onFocusToggle);
    onFocusToggleRef.current = onFocusToggle;

    const assignRef = useCallback(
      (node: HTMLElement | null) => {
        localRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as { current: HTMLElement | null }).current = node;
      },
      [ref],
    );

    useEffect(() => {
      if (open && immersive)
        localRef.current
          ?.querySelector<HTMLButtonElement>('[data-queue-close]')
          ?.focus({ preventScroll: true });
    }, [open, immersive]);

    useEffect(() => {
      const panel = localRef.current;
      const li = panel?.querySelector<HTMLElement>(`[data-queue-key=${JSON.stringify(activeKey)}]`);
      if (open && panel && li) revealQueueItem(panel, li, reduced);
    }, [open, activeKey, reduced]);

    const updateDraft = useCallback((next: SearchItem[]) => {
      draftRef.current = next;
      setDraftState(next);
    }, []);

    // 结束当前拖动会话，但不在结束过程中触发父组件提交。
    const endSession = useCallback(() => {
      const session = sessionRef.current;
      sessionRef.current = null;
      preparedRef.current = null;
      if (!session) return false;
      session.detach();
      // 先清空 session 再停止 Motion 拖动；即使 stop() 迟到的 onDragEnd 也不会提交。
      session.controls.cancel();
      releasePointer(session.element, session.pointerId);
      releasePointer(session.captureTarget, session.pointerId);
      return true;
    }, []);

    const cancelDrag = useCallback(() => {
      const prepared = preparedRef.current;
      const hadSession = endSession();
      preparedRef.current = null;
      // 指针已按下、Motion 尚未触发 onDragStart 时也要停掉它的 pan session。
      if (prepared) {
        prepared.detach();
        prepared.controls.cancel();
        releasePointer(prepared.element, prepared.pointerId);
        releasePointer(prepared.captureTarget, prepared.pointerId);
      }
      if (draggingKeyRef.current !== null || hadSession) {
        draggingKeyRef.current = null;
        setDraggingKey(null);
      }
    }, [endSession]);

    // 拖动开始：用当前队列生成 draft，并保留会话直到松手或取消。
    const beginDrag = useCallback(
      (key: string, point?: { x: number; y: number }) => {
        if (!open) {
          cancelDrag();
          return;
        }
        const prepared = preparedRef.current;
        if (!prepared || prepared.key !== key) return;
        prepared.detach();
        preparedRef.current = null;
        // 在 Motion 的 onDragStart 到达前已经 pointercancel/lostpointercapture：绝不开始可提交会话。
        if (prepared.canceled) {
          prepared.controls.cancel();
          releasePointer(prepared.element, prepared.pointerId);
          releasePointer(prepared.captureTarget, prepared.pointerId);
          return;
        }
        if (sessionRef.current) cancelDrag();
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
        };
        const matches = (event: PointerEvent) => event.pointerId === session.pointerId;
        const move = (event: PointerEvent) => {
          if (!matches(event)) return;
          session.pointer = { x: event.clientX, y: event.clientY };
        };
        // 正常松手交给 Motion 的 onDragEnd 提交一次；这里只标记，避免 lostpointercapture 误取消。
        const up = (event: PointerEvent) => {
          if (matches(event)) session.released = true;
        };
        const cancel = (event: PointerEvent) => {
          if (matches(event)) cancelDrag();
        };
        const lost = (event: PointerEvent) => {
          if (matches(event) && !session.released) cancelDrag();
        };
        // 拖动中焦点可能不在面板内；用拖动期临时监听保证 Escape 一定能取消。
        const escape = (event: KeyboardEvent) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          cancelDrag();
          onCloseRef.current();
          onFocusToggleRef.current();
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', cancel, true);
        window.addEventListener('lostpointercapture', lost, true);
        window.addEventListener('keydown', escape, true);
        session.detach = () => {
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('pointercancel', cancel, true);
          window.removeEventListener('lostpointercapture', lost, true);
          window.removeEventListener('keydown', escape, true);
        };
        sessionRef.current = session;
        preparedRef.current = null;
        draggingKeyRef.current = key;
        // 先写 draft 再打开拖动态，避免未批处理时短暂显示上一次拖动留下的旧顺序。
        updateDraft([...itemsRef.current]);
        setDraggingKey(key);
      },
      [cancelDrag, open, updateDraft],
    );

    // 松手提交：只有这里会把 draft 顺序写回真实队列与持久化。
    const finishDrag = useCallback(
      (key: string) => {
        const session = sessionRef.current;
        // 已取消/已替换的会话即使迟到触发 onDragEnd，也不允许再提交。
        if (!session || session.key !== key || !session.released) return;
        // 面板已关闭或拖动期间队列被外部改动时，按取消处理，绝不覆盖最新队列。
        if (!openRef.current || queueSignature(itemsRef.current) !== session.itemsSignature) {
          cancelDrag();
          return;
        }
        sessionRef.current = null;
        preparedRef.current = null;
        draggingKeyRef.current = null;
        session.detach();
        releasePointer(session.element, session.pointerId);
        releasePointer(session.captureTarget, session.pointerId);
        const finalItems = [...draftRef.current];
        // 先提交父队列再关闭拖动态：未批处理时也不会先显示旧 props 顺序再跳一下。
        onReorderRef.current(finalItems, session.key);
        setDraggingKey(null);
      },
      [cancelDrag],
    );

    const handleReorder = useCallback(
      (next: SearchItem[]) => {
        // 只更新本地 draft；拖动过程中绝不清空 draggedKey，也绝不提前提交。
        updateDraft(next);
      },
      [updateDraft],
    );

    const prepareDrag = useCallback((init: DragPrepareInit) => {
      // 上一次点击留下的准备态先解绑，始终只保留一个待判定指针。
      preparedRef.current?.detach();
      const prepare: DragPrepare = {
        ...init,
        released: false,
        canceled: false,
        detach: () => undefined,
      };
      const matches = (event: PointerEvent) => event.pointerId === prepare.pointerId;
      // Motion 的 onDragStart 延后到阈值后的 frame 才触发；这里提前记录 release/cancel，
      // 避免同一帧内快速松手或取消时创建出错误的提交会话。
      const up = (event: PointerEvent) => {
        if (!matches(event)) return;
        prepare.released = true;
        // Motion 的 onDragStart 可能在一帧后才到；保留 released 标记即可，先解绑监听。
        prepare.detach();
      };
      const cancel = (event: PointerEvent) => {
        if (!matches(event)) return;
        prepare.canceled = true;
        prepare.detach();
      };
      const lost = (event: PointerEvent) => {
        if (!matches(event) || prepare.released) return;
        prepare.canceled = true;
        prepare.detach();
      };
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', cancel, true);
      window.addEventListener('lostpointercapture', lost, true);
      prepare.detach = () => {
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', cancel, true);
        window.removeEventListener('lostpointercapture', lost, true);
      };
      preparedRef.current = prepare;
    }, []);

    // 队列内容/顺序在拖动之外发生变化时同步 draft 基准；若变化发生在拖动中，
    // 按原 panel.ts 的行为取消本次拖动，避免松手后覆盖新队列。
    const itemsSignature = queueSignature(items);
    useEffect(() => {
      if (sessionRef.current) {
        cancelDrag();
        return;
      }
      draftRef.current = [...itemsRef.current];
    }, [itemsSignature, cancelDrag]);

    // 面板关闭或组件卸载时，取消拖动、释放捕获并丢弃尚未提交的 draft。
    useEffect(() => {
      if (open) return;
      cancelDrag();
    }, [open, cancelDrag]);

    useEffect(
      () => () => {
        const session = sessionRef.current;
        const prepared = preparedRef.current;
        sessionRef.current = null;
        preparedRef.current = null;
        draggingKeyRef.current = null;
        if (session) {
          session.detach();
          session.controls.cancel();
          releasePointer(session.element, session.pointerId);
          releasePointer(session.captureTarget, session.pointerId);
        } else if (prepared) {
          // 已按下但 onDragStart 还没到：卸载时也要停掉 Motion 的 pan session。
          prepared.detach();
          prepared.controls.cancel();
          releasePointer(prepared.element, prepared.pointerId);
          releasePointer(prepared.captureTarget, prepared.pointerId);
        }
      },
      [],
    );

    // 边缘滚动仅由 Motion Reorder 内建实现负责，不能再叠加第二个逐帧滚动器。

    const keyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // Escape 同时是拖动取消：不提交、释放捕获并清理会话，然后再关闭面板。
      cancelDrag();
      onClose();
      onFocusToggle();
    };

    // 拖动期间给 Reorder.Group 使用 draft；其余时间始终直接使用最新 props，避免队列原地增删后显示陈旧副本。
    const displayedItems = draggingKey === null ? [...items] : draft;

    return (
      <motion.aside
        ref={assignRef}
        id={props.mode === 'search' ? 'song-search-panel' : 'player-queue-panel'}
        className={`player-queue-panel${props.mode === 'search' ? ' song-search-panel' : ''}${immersive ? ' is-immersive' : ''}`}
        data-player-queue-panel={props.mode === 'search' ? undefined : true}
        data-song-search-panel={props.mode === 'search' ? true : undefined}
        hidden={!open}
        aria-label={props.mode === 'search' ? '搜索歌曲结果' : '播放队列'}
        layoutScroll
        onKeyDown={keyboard}
      >
        <header>
          <strong>{props.mode === 'search' ? '搜索结果 / SONGS' : 'PLAY QUEUE / 播放队列'}</strong>
          <button
            type="button"
            data-queue-close={props.mode === 'search' ? undefined : true}
            data-search-close={props.mode === 'search' ? true : undefined}
            aria-label={props.mode === 'search' ? '关闭搜索结果' : '关闭播放队列'}
            onClick={() => {
              onClose();
              onFocusToggle();
            }}
          >
            <Icon name="close" />
          </button>
          {props.mode !== 'search' && (
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
          )}
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
              readOnly={props.mode === 'search'}
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
              onOpenAlbum={props.mode === 'search' ? props.onOpenAlbum : undefined}
              onRemove={onRemove}
              onSave={onSave}
              onLike={onLike}
              onReorder={onReorder}
            />
          ))}
        </Reorder.Group>
        {props.mode === 'search' ? (
          <>
            <p role="status">
              {props.message || (!props.loading && !items.length ? '没有找到匹配的歌曲' : '')}
            </p>
            {props.hasMore && (
              <button
                type="button"
                className="search-load-more"
                aria-label="加载更多歌曲"
                disabled={props.loading}
                onClick={props.onLoadMore}
              >
                more
              </button>
            )}
          </>
        ) : (
          <p data-queue-empty hidden={items.length > 0}>
            队列为空。可从音乐库或搜索结果加入歌曲。
          </p>
        )}
        <p className="sr-only" data-queue-order-status role="status">
          {orderStatus}
        </p>
      </motion.aside>
    );
  }),
);

export default QueuePanel;
