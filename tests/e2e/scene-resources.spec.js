const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

async function fixture(page) {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.route('**/scene-resources-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="margin:0"><div id="scene" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/scene-resources-fixture');
  const file = fs.readdirSync('frontend/dist/assets').find((name) => /^scene-.*\.js$/.test(name));
  expect(file).toBeTruthy();
  await page.evaluate(async (url) => {
    window.__ArchiveScene = (await import(url)).ArchiveScene;
  }, `/assets/${file}`);
}

test('模型请求迟到时不复活已销毁场景', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/held-model.glb', async (route) => {
    requested = true;
    await held;
    await route.fulfill({
      contentType: 'model/gltf-binary',
      body: fs.readFileSync('frontend/public/assets/archive-cassette.glb'),
    });
  });
  await page.evaluate(() => {
    const scene = new window.__ArchiveScene(document.querySelector('#scene'));
    window.__scene = scene;
    window.__loading = scene.load('/held-model.glb');
  });
  try {
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => window.__scene.dispose());
  } finally {
    release();
  }
  const result = await page.evaluate(async () => {
    await window.__loading;
    const scene = window.__scene;
    return {
      loaded: scene.getStats().loaded,
      children: scene.model.children.length,
      instances: scene.instances.length,
      canvases: document.querySelectorAll('#scene canvas').length,
    };
  });
  expect(result).toEqual({ loaded: false, children: 0, instances: 0, canvases: 0 });
  expect(errors).toEqual([]);
});

test('封面更新与销毁、AO 替换后的共享景深和尺寸同步', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/held-cover.svg', async (route) => {
    requested = true;
    await held;
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    });
  });
  await page.evaluate(async () => {
    const scene = new window.__ArchiveScene(
      document.querySelector('#scene'),
      undefined,
      false,
      'baseline',
      ['/held-cover.svg'],
    );
    window.__scene = scene;
    window.__coverUpdates = 0;
    scene.onCoverUpdate = () => window.__coverUpdates++;
    scene.setQuality({
      scale: 50,
      pixelRatio: 1,
      antialias: 'off',
      shadows: 0,
      aoSamples: 16,
      aoResolution: 1,
      depthOfField: 50,
      transmission: 0.25,
      anisotropy: 1,
    });
    await scene.load();
  });
  try {
    await expect.poll(() => requested).toBe(true);
    const result = await page.evaluate(() => {
      const scene = window.__scene;
      const old = scene.ao;
      let disposed = 0;
      const dispose = old.dispose.bind(old);
      old.dispose = () => {
        disposed++;
        dispose();
      };
      const index = scene.composer.passes.indexOf(old);
      scene.setQuality({ ...scene.quality, aoSamples: 32 });
      scene.setReduced(true);
      scene.finishOpening(true);
      scene.update(performance.now() / 1000);
      const current = scene.ao;
      const stable = scene.composer.passes.indexOf(current) === index;
      const sourceCurrent = scene.bokeh.source() === current;
      const shared = current.normalRenderTarget.textures.length === 2;
      scene.container.style.height = '360px';
      scene.resize();
      scene.update(performance.now() / 1000 + 0.1);
      return {
        disposed,
        replaced: old !== current,
        stable,
        sourceCurrent,
        shared,
        aspect: scene.camera.aspect,
        width: current.width,
        height: current.height,
        loaded: scene.getStats().loaded,
      };
    });
    expect(result).toMatchObject({
      disposed: 1,
      replaced: true,
      stable: true,
      sourceCurrent: true,
      shared: true,
      aspect: 640 / 360,
      loaded: true,
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    // 同一贴图加载器实例由 owner 访问，监听迟到源纹理的真实释放。
    await page.evaluate(() => {
      window.__lateReleased = 0;
      const fallback = window.__scene.fallbackCover;
      const texturePrototype = Object.getPrototypeOf(Object.getPrototypeOf(fallback));
      const dispose = texturePrototype.dispose;
      texturePrototype.dispose = function () {
        if (!this.isCanvasTexture) window.__lateReleased++;
        return dispose.call(this);
      };
      window.__restoreTextureDispose = () => {
        texturePrototype.dispose = dispose;
      };
      window.__scene.dispose();
      window.__lateReleased = 0;
    });
  } finally {
    release();
  }
  await expect.poll(() => page.evaluate(() => window.__lateReleased)).toBe(1);
  expect(
    await page.evaluate(() => ({
      updates: window.__coverUpdates,
      loaded: window.__scene.getStats().loaded,
      covers: window.__scene.coverTextures.length,
      canvases: document.querySelectorAll('#scene canvas').length,
    })),
  ).toEqual({ updates: 0, loaded: false, covers: 0, canvases: 0 });
  await page.evaluate(() => window.__restoreTextureDispose());
  expect(errors).toEqual([]);
});
