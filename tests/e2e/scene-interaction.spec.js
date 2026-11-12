const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test.use({ deviceScaleFactor: 1 });
test('档案真实指针绑定：点击、双轴拖动、滚轮、详情旋转、多指取消和销毁', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 960, height: 640 });
  await page.route('**/scene-interaction-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><div id="scene" style="width:100vw;height:100vh"></div><style>canvas{touch-action:none}</style></body></html>',
    }),
  );
  await page.goto('/scene-interaction-fixture');
  const file = fs.readdirSync('frontend/dist/assets').find((name) => /^scene-.*\.js$/.test(name));
  expect(file).toBeTruthy();
  await page.evaluate(async (url) => {
    const { ArchiveScene } = await import(url);
    const scene = new ArchiveScene(document.querySelector('#scene'));
    scene.setQuality({
      scale: 50,
      pixelRatio: 1,
      antialias: 'off',
      shadows: 0,
      aoSamples: 0,
      aoResolution: 0.5,
      depthOfField: 0,
      transmission: 0.25,
      anisotropy: 1,
    });
    await scene.load();
    scene.setSuperPerformance(true);
    scene.setReduced(true);
    scene.finishOpening(true);
    const events = { select: [], navigate: [] };
    scene.onSelect = (index, cell) => {
      events.select.push({ index, cell });
      scene.select(index, cell ? { cell } : undefined);
    };
    scene.onNavigate = (axis, direction) => events.navigate.push([axis, direction]);
    let time = performance.now() / 1000;
    window.__interaction = {
      scene,
      events,
      advance(count = 1) {
        const render = scene.renderer.render;
        scene.renderer.render = () => {};
        try {
          for (let i = 0; i < count; i++) scene.update((time += 0.05));
        } finally {
          scene.renderer.render = render;
        }
        scene.renderState.invalidate();
        scene.update((time += 0.05));
      },
    };
    window.__interaction.advance(25);
  }, `/assets/${file}`);
  const point = () => page.evaluate(() => window.__interaction.scene.projectCard(0, 3.5));
  const stats = () => page.evaluate(() => window.__interaction.scene.getStats());
  const selections = () => page.evaluate(() => window.__interaction.events.select.length);
  const first = await point();
  await page.mouse.click(first[0], first[1]);
  expect(await selections()).toBe(1);
  const before = await stats();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(480, 350, { steps: 8 });
  await page.evaluate(() => window.__interaction.advance(1));
  const dragging = await stats();
  expect(dragging.holdingArchive).toBe(true);
  expect(dragging.dragTrack).not.toBeNull();
  expect(dragging.columnCamera).not.toBe(before.columnCamera);
  expect(dragging.rail).not.toBe(before.rail);
  const during = await selections();
  await page.mouse.up();
  expect(await selections()).toBe(during);
  expect((await stats()).holdingArchive).toBe(false);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => window.__interaction.events.navigate.length)).toBe(1);
  expect(await page.evaluate(() => window.__interaction.events.navigate[0])).toEqual(['row', 1]);

  await page.evaluate(() => {
    const { scene, advance } = window.__interaction;
    scene.setMode('detail');
    advance(120);
  });
  expect((await stats()).canInspect).toBe(true);
  const navigateCount = await page.evaluate(() => window.__interaction.events.navigate.length);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 300, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(() => window.__interaction.advance(30));
  expect((await stats()).rotation).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__interaction.events.navigate.length)).toBe(
    navigateCount,
  );
  await page.evaluate(() => {
    const { scene, advance } = window.__interaction;
    scene.setMode('archive');
    advance(160);
  });

  await page.mouse.move(400, 300);
  await page.mouse.down();
  expect((await stats()).holdingArchive).toBe(true);
  const beforeCancel = await selections();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  expect((await stats()).holdingArchive).toBe(false);
  expect(await selections()).toBe(beforeCancel);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.__interaction.scene.resize();
    window.__interaction.advance(40);
  });
  const touch = await page.context().newCDPSession(page);
  const count = await selections();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 180, y: 400 },
      { x: 230, y: 420 },
    ],
  });
  expect((await stats()).holdingArchive).toBe(false);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await selections()).toBe(count);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 180, y: 400 }],
  });
  expect((await stats()).holdingArchive).toBe(true);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect((await stats()).holdingArchive).toBe(false);
  await touch.detach();
  const next = await point();
  await page.mouse.click(next[0], next[1]);
  expect(await selections()).toBe(count + 1);
  await page.mouse.move(180, 400);
  await page.mouse.down();
  expect((await stats()).holdingArchive).toBe(true);
  const finalCount = await selections();
  await page.evaluate(() => window.__interaction.scene.dispose());
  await page.mouse.up();
  expect(await page.locator('canvas').count()).toBe(0);
  expect(await selections()).toBe(finalCount);
  expect(errors).toEqual([]);
});
