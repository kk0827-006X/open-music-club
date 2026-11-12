const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');

async function withBindings(run) {
  await withReactHarness(async (h) => {
    const { bindArchiveInteractions } =
      await import('../frontend/src/rhine/interaction-bindings.ts');
    const { ArchiveDrag } = await import('../frontend/src/rhine/archive-drag.ts');
    const { COLUMN_SPACING, ROW_SPACING } = await import('../frontend/src/rhine/archive-loop.ts');
    const canvas = h.document.createElement('canvas');
    h.document.body.append(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
    Object.defineProperty(canvas, 'clientHeight', { value: 300 });
    const captured = new Set();
    const calls = {
      select: [],
      hover: [],
      plane: [],
      navigate: [],
      relay: [],
      capture: [],
      release: [],
    };
    let stamp = 0;
    const pointer = (type, id, x = 100, y = 100, extra = {}) => {
      const event = new h.window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: extra.button ?? 0,
      });
      Object.defineProperties(event, {
        pointerId: { value: id },
        pointerType: { value: extra.pointerType ?? 'mouse' },
        timeStamp: { value: extra.timeStamp ?? (stamp += 16) },
        ...(extra.coalesced ? { getCoalescedEvents: { value: () => extra.coalesced } } : {}),
      });
      (extra.target ?? canvas).dispatchEvent(event);
      return event;
    };
    canvas.setPointerCapture = (id) => {
      captured.add(id);
      calls.capture.push(id);
    };
    canvas.hasPointerCapture = (id) => captured.has(id);
    canvas.releasePointerCapture = (id) => {
      captured.delete(id);
      calls.release.push(id);
      pointer('lostpointercapture', id);
    };
    const abort = new h.window.AbortController();
    const ctx = {
      canvas,
      signal: abort.signal,
      allowed: true,
      canInspect: false,
      relayActive: false,
      reduced: false,
      clock: 12,
      dragging: false,
      dragTrack: null,
      holdingArchive: false,
      archiveMomentum: null,
      lastInteraction: 0,
      targetRotation: 0,
      columnCamera: { value: 0, velocity: 0 },
      rail: { value: -2.17, velocity: 0 },
      pointer: {
        x: 0,
        y: 0,
        set(x, y) {
          this.x = x;
          this.y = y;
        },
      },
      archiveDrag: new ArchiveDrag(),
      canBrowse: () => ctx.allowed,
      setHover: (cell) => calls.hover.push(cell),
      pickCell: () => ({ lane: 2, row: 12 }),
      stopMomentum() {
        if (ctx.archiveMomentum) ctx.columnCamera.velocity = ctx.rail.velocity = 0;
        ctx.archiveMomentum = null;
      },
      dragProjection: () => ({ lane: { x: 100, y: 0 }, row: { x: 0, y: 100 } }),
      trackCoordinate: (axis, value) =>
        axis === 'lane' ? value / COLUMN_SPACING + 2 : (-value - 2.17) / ROW_SPACING + 15.5,
      navigatePlane: (position) => calls.plane.push(position),
      onSelect: (...args) => calls.select.push(args),
      onNavigate: (...args) => calls.navigate.push(args),
      onRelayPick: (key) => calls.relay.push(key),
    };
    const cancel = bindArchiveInteractions(ctx);
    const wheel = (options) => {
      const event = new h.window.WheelEvent('wheel', { cancelable: true, ...options });
      canvas.dispatchEvent(event);
      return event;
    };
    try {
      await run({
        h,
        ctx,
        calls,
        captured,
        pointer,
        wheel,
        cancel,
        abort,
        COLUMN_SPACING,
        ROW_SPACING,
      });
    } finally {
      abort.abort();
      cancel();
    }
  });
}

it('悬停和点击读取实时状态与回调，右键及非浏览状态不开始交互', async () => {
  await withBindings(({ ctx, calls, pointer }) => {
    pointer('pointerdown', 1, 100, 100, { button: 2 });
    assert.equal(calls.capture.length, 0);
    pointer('pointermove', 1, 200, 150);
    assert.deepEqual(calls.hover.at(-1), { lane: 2, row: 12 });
    assert.deepEqual([ctx.pointer.x, ctx.pointer.y], [0, 0]);
    ctx.allowed = false;
    const count = calls.hover.length;
    pointer('pointermove', 1, 300, 200);
    pointer('pointerdown', 1);
    assert.equal(calls.hover.length, count);
    assert.equal(calls.capture.length, 0);
    ctx.allowed = true;
    const latest = [];
    ctx.onSelect = (...args) => latest.push(args);
    pointer('pointerdown', 1);
    pointer('pointerup', 1);
    assert.equal(latest.length, 1);
    assert.equal(calls.select.length, 0);
    assert.deepEqual(latest[0][1], { lane: 2, row: 12 });
    assert.equal(ctx.holdingArchive, false);
    assert.equal(ctx.dragTrack, null);
  });
});

it('合并采样拖动沿原投影更新双轴坐标，释放产生动量且不误触点击', async () => {
  await withBindings(({ ctx, calls, pointer, COLUMN_SPACING, ROW_SPACING }) => {
    pointer('pointerdown', 1, 100, 100, { timeStamp: 0 });
    pointer('pointermove', 1, 130, 120, {
      timeStamp: 32,
      coalesced: [{ clientX: 120, clientY: 115, timeStamp: 16 }],
    });
    assert.equal(ctx.columnCamera.value, 0.3 * COLUMN_SPACING);
    assert.equal(ctx.rail.value, -2.17 - 0.2 * ROW_SPACING);
    assert.equal(ctx.columnCamera.velocity, 0);
    assert.equal(ctx.rail.velocity, 0);
    assert.equal(ctx.lastInteraction, 12);
    assert.ok(Math.abs(calls.plane.at(-1).lane - 2.3) < 1e-12);
    pointer('pointerup', 1, 140, 130, { timeStamp: 48 });
    assert.ok(ctx.archiveMomentum);
    assert.ok(ctx.archiveMomentum.motion.lane.velocity > 0);
    assert.equal(calls.select.length, 0);
    assert.equal(ctx.dragTrack, null);
  });
});

it('减少动态效果和浏览权限变化在手势中实时生效', async () => {
  await withBindings(({ ctx, calls, pointer }) => {
    pointer('pointerdown', 1);
    pointer('pointermove', 1, 140, 140);
    ctx.reduced = true;
    pointer('pointerup', 1, 150, 150);
    assert.equal(ctx.archiveMomentum, null);
    pointer('pointerdown', 2);
    ctx.allowed = false;
    pointer('pointermove', 2, 150, 150);
    assert.equal(ctx.holdingArchive, false);
    assert.equal(ctx.dragTrack, null);
    pointer('pointerup', 2);
    assert.equal(calls.select.length, 0);
  });
});

for (const reason of ['pointercancel', 'lostpointercapture']) {
  it(`${reason} 清理捕获与拖动，迟到抬手不触发选择`, async () => {
    await withBindings(({ ctx, calls, captured, pointer }) => {
      pointer('pointerdown', 1);
      pointer('pointermove', 1, 130, 130);
      pointer(reason, 1);
      pointer('pointerup', 1);
      assert.equal(ctx.dragTrack, null);
      assert.equal(ctx.holdingArchive, false);
      assert.equal(captured.size, 0);
      assert.equal(calls.select.length, 0);
    });
  });
}

it('第二根触点取消第一根手势，窗口外抬手清理后可重新点击', async () => {
  await withBindings(({ h, ctx, calls, pointer }) => {
    pointer('pointerdown', 1, 100, 100, { pointerType: 'touch' });
    pointer('pointerdown', 2, 150, 150, { pointerType: 'touch' });
    assert.equal(ctx.holdingArchive, false);
    pointer('pointerup', 1, 100, 100, { target: h.window, pointerType: 'touch' });
    pointer('pointercancel', 2, 150, 150, { target: h.window, pointerType: 'touch' });
    assert.equal(calls.select.length, 0);
    pointer('pointerdown', 3);
    pointer('pointerup', 3);
    assert.equal(calls.select.length, 1);
  });
});

it('详情拖动只调整旋转并保留上下限，不能触发档案平面导航', async () => {
  await withBindings(({ ctx, calls, pointer }) => {
    ctx.allowed = false;
    ctx.canInspect = true;
    pointer('pointerdown', 1);
    assert.equal(ctx.dragging, true);
    pointer('pointermove', 1, 1000, 100);
    assert.equal(ctx.targetRotation, 0.8);
    pointer('pointermove', 1, -1000, 100);
    assert.equal(ctx.targetRotation, -0.8);
    pointer('pointerup', 1);
    assert.equal(ctx.dragging, false);
    assert.equal(calls.plane.length, 0);
    assert.equal(calls.select.length, 0);
  });
});

it('relay 仅在未移动的点击触发拾取，并阻止滚轮与平面拖动', async () => {
  await withBindings(({ ctx, calls, pointer, wheel }) => {
    ctx.relayActive = true;
    pointer('pointerdown', 1);
    pointer('pointerup', 1);
    assert.deepEqual(calls.relay, ['2:12']);
    pointer('pointerdown', 2);
    pointer('pointermove', 2, 150, 150);
    pointer('pointerup', 2, 150, 150);
    assert.equal(calls.relay.length, 1);
    assert.equal(calls.plane.length, 0);
    assert.equal(wheel({ deltaY: 100 }).defaultPrevented, true);
    assert.equal(calls.navigate.length, 0);
  });
});

it('滚轮保留累计阈值、方向反转、最大步数和 ctrl/横向滚动放行', async () => {
  await withBindings(({ calls, wheel }) => {
    assert.equal(wheel({ deltaY: 60 }).defaultPrevented, true);
    assert.equal(calls.navigate.length, 0);
    wheel({ deltaY: 40 });
    assert.deepEqual(calls.navigate, [['row', 1]]);
    wheel({ deltaY: 10000 });
    assert.equal(calls.navigate.length, 4);
    wheel({ deltaY: -100 });
    assert.deepEqual(calls.navigate.at(-1), ['row', -1]);
    const count = calls.navigate.length;
    assert.equal(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented, false);
    assert.equal(wheel({ deltaY: 100, deltaX: 200 }).defaultPrevented, false);
    assert.equal(calls.navigate.length, count);
  });
});

for (const reason of ['blur', 'resize', 'visibilitychange']) {
  it(`${reason} 取消拖动和动量，AbortSignal 移除全部监听`, async () => {
    await withBindings(({ h, ctx, calls, pointer, wheel, abort, cancel }) => {
      pointer('pointerdown', 1);
      pointer('pointermove', 1, 130, 130);
      ctx.archiveMomentum = { motion: {}, time: 0 };
      ctx.columnCamera.velocity = ctx.rail.velocity = 5;
      if (reason === 'visibilitychange') {
        Object.defineProperty(h.document, 'hidden', { configurable: true, value: true });
        h.document.dispatchEvent(new h.window.Event(reason));
      } else h.window.dispatchEvent(new h.window.Event(reason));
      assert.equal(ctx.dragTrack, null);
      assert.equal(ctx.archiveMomentum, null);
      assert.equal(ctx.columnCamera.velocity, 0);
      assert.equal(ctx.rail.velocity, 0);
      assert.equal(ctx.holdingArchive, false);
      abort.abort();
      cancel();
      const counts = JSON.stringify(calls);
      pointer('pointerdown', 2);
      pointer('pointerup', 2);
      wheel({ deltaY: 100 });
      h.window.dispatchEvent(new h.window.Event('blur'));
      assert.equal(JSON.stringify(calls), counts);
    });
  });
}
