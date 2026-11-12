import { MathUtils } from 'three';
import {
  ArchivePlaneMomentum,
  type ArchiveDrag,
  type DragAxis,
  type DragPosition,
  type DragProjection,
} from './archive-drag';
import { COLUMN_SPACING, ROW_SPACING, cellKey, fileAtCell, type ArchiveCell } from './archive-loop';

// 只暴露绑定交互所需的能力；可变属性由场景通过实时 getter/setter 连接。
export interface ArchiveInteractionContext {
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly pointer: { set(x: number, y: number): void };
  readonly archiveDrag: ArchiveDrag;
  readonly columnCamera: { value: number; velocity: number };
  readonly rail: { value: number; velocity: number };
  readonly relayActive: boolean;
  readonly canInspect: boolean;
  readonly reduced: boolean;
  readonly clock: number;
  dragging: boolean;
  dragTrack: DragPosition | null;
  holdingArchive: boolean;
  archiveMomentum: { motion: ArchivePlaneMomentum; time: number } | null;
  lastInteraction: number;
  targetRotation: number;
  navigatingDrag: boolean;
  canBrowse(): boolean;
  stopMomentum(): void;
  setHover(cell: ArchiveCell | null): void;
  pickCell(x: number, y: number): ArchiveCell | null;
  dragProjection(): DragProjection;
  trackCoordinate(axis: DragAxis, value: number): number;
  navigatePlane(coordinate: DragPosition): void;
  onSelect?(index: number, cell: ArchiveCell): void;
  onNavigate?(axis: 'row' | 'lane', direction: number): void;
  onRelayPick?(key: string | null): void;
}

// 监听生命周期仍由场景的 AbortSignal 持有；返回的取消动作供模式切换和销毁共用。
export function bindArchiveInteractions(context: ArchiveInteractionContext): () => void {
  const canvas = context.canvas;
  let activePointer: number | null = null;
  let previousX = 0,
    startX = 0,
    startY = 0,
    moved = false;
  let browse = false,
    cancelled = false;
  let startTrack = { lane: 0, row: 0 };
  let wheelTotal = 0,
    wheelTime = 0;
  const pointers = new Set<number>();
  const hover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !context.canBrowse() || context.archiveMomentum) return;
    const r = canvas.getBoundingClientRect();
    context.pointer.set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
    const cell = context.pickCell(e.clientX, e.clientY);
    context.setHover(cell);
    canvas.style.cursor = cell ? 'pointer' : 'grab';
  };
  const reset = () => {
    const id = activePointer;
    activePointer = null;
    context.dragging = false;
    context.dragTrack = null;
    context.holdingArchive = false;
    browse = false;
    context.setHover(null);
    canvas.style.cursor = context.canBrowse() ? 'grab' : 'default';
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const cancelPointer = () => {
    cancelled = true;
    context.stopMomentum();
    pointers.clear();
    wheelTotal = 0;
    reset();
  };
  const moveArchive = (e: PointerEvent) => {
    const pending = !context.archiveDrag.active;
    for (const sample of e.getCoalescedEvents?.() ?? []) {
      context.archiveDrag.move(sample.clientX, sample.clientY, sample.timeStamp);
    }
    context.archiveDrag.move(e.clientX, e.clientY, e.timeStamp);
    moved ||= context.archiveDrag.moved;
    if (!context.archiveDrag.active) return;
    if (pending) {
      startTrack = { lane: context.columnCamera.value, row: context.rail.value };
    }
    context.setHover(null);
    context.lastInteraction = context.clock;
    canvas.style.cursor = 'grabbing';
    context.dragTrack = {
      lane: startTrack.lane + context.archiveDrag.value.lane * COLUMN_SPACING,
      row: startTrack.row - context.archiveDrag.value.row * ROW_SPACING,
    };
    context.columnCamera.value = context.dragTrack.lane;
    context.rail.value = context.dragTrack.row;
    context.columnCamera.velocity = context.rail.velocity = 0;
    context.navigatePlane({
      lane: context.trackCoordinate('lane', context.columnCamera.value),
      row: context.trackCoordinate('row', context.rail.value),
    });
  };
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!context.canBrowse() && !context.canInspect) return;
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        cancelled = true;
        reset();
        return;
      }
      activePointer = e.pointerId;
      cancelled = false;
      moved = context.archiveMomentum !== null;
      startX = previousX = e.clientX;
      startY = e.clientY;
      browse = context.canBrowse();
      context.stopMomentum();
      if (browse) {
        context.columnCamera.velocity = 0;
        context.rail.velocity = 0;
      }
      context.holdingArchive = browse;
      context.dragging = !browse && context.canInspect;
      startTrack = { lane: context.columnCamera.value, row: context.rail.value };
      context.archiveDrag.start(e.clientX, e.clientY, context.dragProjection(), e.timeStamp);
      context.setHover(null);
      canvas.setPointerCapture(e.pointerId);
      if (context.relayActive) {
        context.holdingArchive = false;
        context.dragging = false;
      }
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (context.relayActive) {
        if (e.pointerId === activePointer)
          moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 7;
        return;
      }
      if (activePointer !== null && e.pointerId !== activePointer) return;
      if (activePointer === null) {
        hover(e);
        return;
      }
      if (cancelled) return;
      moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 7;
      if (browse) {
        if (!context.canBrowse()) {
          cancelPointer();
          return;
        }
        moveArchive(e);
        return;
      }
      if (context.dragging && context.canInspect) {
        context.targetRotation = MathUtils.clamp(
          context.targetRotation + (e.clientX - previousX) * 0.004,
          -0.8,
          0.8,
        );
        previousX = e.clientX;
      }
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId !== activePointer) return;
      if (context.relayActive) {
        if (!cancelled && !moved) {
          const cell = context.pickCell(e.clientX, e.clientY);
          context.onRelayPick?.(cell ? cellKey(cell) : null);
        }
        reset();
        return;
      }
      if (!cancelled && browse && context.canBrowse()) {
        moveArchive(e);
        if (context.archiveDrag.active) {
          if (!context.reduced) {
            context.archiveMomentum = {
              time: performance.now() / 1000,
              motion: new ArchivePlaneMomentum(
                {
                  lane: context.trackCoordinate('lane', context.columnCamera.value),
                  row: context.trackCoordinate('row', context.rail.value),
                },
                context.archiveDrag.releaseVelocity(e.timeStamp, false),
              ),
            };
          }
        } else if (!moved) {
          const cell = context.pickCell(e.clientX, e.clientY);
          if (cell) context.onSelect?.(fileAtCell(cell), cell);
        }
      }
      reset();
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'pointercancel',
    (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'lostpointercapture',
    (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'pointerleave',
    () => {
      context.pointer.set(0, 0);
      context.setHover(null);
    },
    { signal: context.signal },
  );
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (context.relayActive) {
        e.preventDefault();
        return;
      }
      if (
        !context.canBrowse() ||
        activePointer !== null ||
        e.ctrlKey ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY)
      )
        return;
      e.preventDefault();
      if (context.archiveMomentum) context.stopMomentum();
      const now = performance.now();
      const delta = MathUtils.clamp(
        e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? canvas.clientHeight : 1),
        -300,
        300,
      );
      if (now - wheelTime > 180 || Math.sign(delta) !== Math.sign(wheelTotal)) wheelTotal = 0;
      wheelTime = now;
      wheelTotal += delta;
      const steps = Math.min(3, Math.floor(Math.abs(wheelTotal) / 100));
      if (!steps) return;
      const direction = Math.sign(wheelTotal);
      wheelTotal -= direction * steps * 100;
      context.navigatingDrag = true;
      try {
        for (let i = 0; i < steps; i++) context.onNavigate?.('row', direction);
      } finally {
        context.navigatingDrag = false;
      }
    },
    { ...{ passive: false }, signal: context.signal },
  );
  window.addEventListener('blur', () => cancelPointer(), {
    signal: context.signal,
  });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) cancelPointer();
    },
    { signal: context.signal },
  );
  window.addEventListener('resize', () => cancelPointer(), {
    signal: context.signal,
  });
  // 多指取消捕获后，触点仍可能在画布外结束。
  window.addEventListener('pointerup', (e) => pointers.delete(e.pointerId), {
    signal: context.signal,
  });
  window.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId), {
    signal: context.signal,
  });
  return cancelPointer;
}
