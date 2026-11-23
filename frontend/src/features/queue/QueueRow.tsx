import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import type { SearchItem } from '../../shared/music.ts';
import { Icon } from '../../shared/react/ui.tsx';
import { replaceBrokenCover } from '../../shared/react/image.ts';

// cancel() 不派发迟到的 onDragEnd，防止取消后马上重拖同一曲目时误提交。
type DragControlsLike = { cancel(): void };

export type DragPrepareInit = {
  key: string;
  pointerId: number;
  x: number;
  y: number;
  element: HTMLElement;
  captureTarget: HTMLElement;
  controls: DragControlsLike;
};

// 只滚动队列自身；scrollIntoView 会连带移动 overflow:hidden 的播放器和档案页。
export function revealQueueItem(panel: HTMLElement, item: HTMLElement, reduced: boolean) {
  const bounds = panel.getBoundingClientRect();
  const row = item.getBoundingClientRect();
  const top = bounds.top + panel.clientTop;
  const bottom = top + panel.clientHeight;
  const header = panel.querySelector('header');
  const visibleTop = Math.max(top, header?.getBoundingClientRect().bottom ?? top);
  const delta =
    row.top < visibleTop ? row.top - visibleTop : row.bottom > bottom ? row.bottom - bottom : 0;
  if (!delta) return;
  const target = Math.max(
    0,
    Math.min(panel.scrollTop + delta, panel.scrollHeight - panel.clientHeight),
  );
  panel.scrollTo({ top: target, behavior: reduced ? ('instant' as ScrollBehavior) : 'smooth' });
}

type QueueRowProps = {
  readOnly?: boolean;
  item: SearchItem;
  index: number;
  activeKey?: string;
  reduced: boolean;
  liked: boolean;
  likeKnown: boolean;
  pending: boolean;
  dragging: boolean;
  getPanel(): HTMLElement | null;
  items: readonly SearchItem[];
  onDragPrepare(prepare: DragPrepareInit): void;
  onDragStart(key: string, point?: { x: number; y: number }): void;
  onDragEnd(key: string): void;
  onPlay(item: SearchItem): void;
  onOpenAlbum?(item: SearchItem): void;
  onRemove(item: SearchItem): void;
  onSave(item: SearchItem): void;
  onLike(item: SearchItem): void;
  onReorder(items: SearchItem[], movedKey?: string): void;
};

export function QueueRow(props: QueueRowProps) {
  const controls = useDragControls();
  const focusFrame = useRef(0);
  const {
    item,
    index,
    activeKey,
    reduced,
    liked,
    likeKnown,
    pending,
    dragging,
    getPanel,
    items,
    onDragPrepare,
    onDragStart,
    onDragEnd,
    onPlay,
    onOpenAlbum,
    onRemove,
    onSave,
    onLike,
    onReorder,
  } = props;
  const className =
    [item.key === activeKey ? 'is-active' : '', dragging ? 'is-dragging' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const transition = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 520, damping: 28, mass: 0.62 };

  // 组件可能在焦点回填的两帧之间被关闭，卸载时取消待执行 frame。
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  const moveByKeyboard = (direction: -1 | 1) => {
    const current = items.findIndex((entry) => entry.key === item.key);
    if (current < 0) return;
    const target = Math.max(0, Math.min(items.length - 1, current + direction));
    if (target === current) return;
    const next = [...items];
    const [moved] = next.splice(current, 1);
    next.splice(target, 0, moved);
    // 键盘排序仍然立即提交一次，不走拖动的 draft/onDragEnd 链路。
    onReorder(next, item.key);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = 0;
        const panel = getPanel();
        // 两帧之间面板可能已关闭；hidden 时不把焦点抢回不可见手柄。
        if (!panel || panel.hidden) return;
        const handle = Array.from(
          panel.querySelectorAll<HTMLElement>('[data-queue-drag]') ?? [],
        ).find((button) => button.dataset.queueDrag === item.key);
        handle?.focus({ preventScroll: true });
        const row = handle?.closest<HTMLElement>('li');
        if (row) revealQueueItem(panel, row, reduced);
      });
    });
  };

  const keyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    moveByKeyboard(event.key === 'ArrowUp' ? -1 : 1);
  };

  // 保持原来的整行拖拽：动作按钮和输入框之外的位置都能开始拖动。
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button:not([data-queue-drag]), input, select, textarea')
    )
      return;
    onDragPrepare({
      key: item.key,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      element: event.currentTarget,
      captureTarget: event.target instanceof HTMLElement ? event.target : event.currentTarget,
      controls,
    });
    controls.start(event);
  };

  const title = (
    <>
      <strong>{item.title}</strong>
      <small>
        {item.artist} / {item.source === 'local' ? 'LOCAL' : 'NETEASE'}
      </small>
    </>
  );

  return (
    <Reorder.Item
      as="li"
      value={item}
      data-queue-key={item.key}
      className={className}
      drag={props.readOnly ? false : 'y'}
      dragListener={false}
      dragControls={controls}
      layout
      transition={transition}
      whileDrag={reduced ? undefined : { scale: 1.02 }}
      onPointerDown={props.readOnly ? undefined : startDrag}
      onClick={
        onOpenAlbum &&
        ((event) => {
          if (event.target instanceof Element && !event.target.closest('button')) onOpenAlbum(item);
        })
      }
      onDragStart={(event) => {
        // Motion 的 onDragStart 在越过阈值后的 frame 中触发，此时指针可能已不再是按下点。
        const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : undefined;
        onDragStart(item.key, point);
      }}
      onDragEnd={() => onDragEnd(item.key)}
    >
      {props.readOnly ? (
        <span className="queue-drag-handle" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
      ) : (
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
      )}
      <img src={item.coverUrl} alt="" draggable={false} onError={replaceBrokenCover} />
      {onOpenAlbum ? (
        <button
          type="button"
          className="queue-copy"
          data-search-open-album={item.key}
          aria-label={`打开 ${item.title} 所属专辑`}
          onClick={() => onOpenAlbum(item)}
        >
          {title}
        </button>
      ) : (
        <div className="queue-copy">{title}</div>
      )}
      <div className="queue-actions">
        <button
          type="button"
          data-queue-play={item.key}
          aria-label={`播放 ${item.title}`}
          title="播放"
          onClick={() => onPlay(item)}
        >
          <Icon name="playerPlay" filled />
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
        {!props.readOnly && (
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
        )}
        {!props.readOnly && (
          <button
            type="button"
            data-queue-remove={item.key}
            aria-label={`移除 ${item.title}`}
            title="移除"
            onClick={() => onRemove(item)}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    </Reorder.Item>
  );
}

// 队列拖拽由 Motion Reorder 负责碰撞与弹簧回位；本组件不再自造逐帧拖拽引擎。
// 拖动期间只更新本地 draft；松手（onDragEnd）才向父组件提交一次真实队列顺序与持久化。
