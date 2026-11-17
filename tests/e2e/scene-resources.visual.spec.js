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
      children: scene.runtime.assets.model.children.length,
      instances: scene.runtime.assets.instances.length,
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
      const old = scene.runtime.rendering.ao;
      let disposed = 0;
      const dispose = old.dispose.bind(old);
      old.dispose = () => {
        disposed++;
        dispose();
      };
      const index = scene.runtime.rendering.composer.passes.indexOf(old);
      scene.setQuality({ ...scene.runtime.rendering.currentQuality, aoSamples: 32 });
      scene.setReduced(true);
      scene.finishOpening(true);
      scene.update(performance.now() / 1000);
      const current = scene.runtime.rendering.ao;
      const stable = scene.runtime.rendering.composer.passes.indexOf(current) === index;
      const sourceCurrent = scene.runtime.rendering.bokeh.source() === current;
      const shared = current.normalRenderTarget.textures.length === 2;
      scene.runtime.options.container.style.height = '360px';
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
      const fallback = window.__scene.runtime.assets.fallbackCover;
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
      covers: window.__scene.runtime.assets.coverTextures.length,
      canvases: document.querySelectorAll('#scene canvas').length,
    })),
  ).toEqual({ updates: 0, loaded: false, covers: 0, canvases: 0 });
  await page.evaluate(() => window.__restoreTextureDispose());
  expect(errors).toEqual([]);
});

test('拆分后的两个场景隔离共享状态，未加载和销毁后的帧不渲染', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  const result = await page.evaluate(() => {
    const first = new window.__ArchiveScene(document.querySelector('#scene'));
    const secondContainer = document.createElement('div');
    secondContainer.style.cssText = 'width:320px;height:240px';
    document.body.append(secondContainer);
    const second = new window.__ArchiveScene(secondContainer);
    try {
      first.setArchiveCoverage(true);
      first.setAudioBands({ low: 1, mid: 0, high: 0, activity: 1, spectrum: new Float32Array(64) });
      first.setMode('detail');
      first.update(1);
      const isolated =
        first.runtime.assets !== second.runtime.assets &&
        first.runtime.assets.model !== second.runtime.assets.model &&
        first.camera !== second.camera &&
        first.runtime.rendering !== second.runtime.rendering &&
        first.state.selection.pulses !== second.state.selection.pulses &&
        first.state.interaction.hoverLifts !== second.state.interaction.hoverLifts;
      const beforeDispose = {
        isolated,
        coverage: second.state.render.extraCoverage,
        audio: second.state.audio.audioBands === undefined,
        detail: second.state.selection.targetDetail,
        draws: first.getStats().renderedFrames,
      };
      first.dispose();
      first.update(2);
      first.dispose();
      return {
        ...beforeDispose,
        afterDraws: first.getStats().renderedFrames,
        firstAborted: first.runtime.inputEvents.signal.aborted,
        secondAborted: second.runtime.inputEvents.signal.aborted,
        firstCanvases: document.querySelectorAll('#scene canvas').length,
        secondConnected: second.renderer.domElement.isConnected,
      };
    } finally {
      first.dispose();
      second.dispose();
      secondContainer.remove();
    }
  });
  expect(result).toEqual({
    isolated: true,
    coverage: false,
    audio: true,
    detail: 0,
    draws: 0,
    afterDraws: 0,
    firstAborted: true,
    secondAborted: false,
    firstCanvases: 0,
    secondConnected: true,
  });
  expect(errors).toEqual([]);
});

test('普通函数回调和自定义波形保留场景接收者，资源通知读取最新回调', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  await page.evaluate(async () => {
    const results = [];
    let scene;
    function pulse(distance, age) {
      results.push({ kind: 'pulse', owner: this === scene, distance, age });
      return 0.25;
    }
    const cover =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
      );
    scene = new window.__ArchiveScene(document.querySelector('#scene'), pulse, false, 'baseline', [
      cover,
    ]);
    window.__callbacks = { scene, results };
    const record = (kind) =>
      function () {
        results.push({ kind, owner: this === scene });
      };
    scene.onCoverUpdate = record('old-cover');
    scene.onCoverUpdate = record('cover');
    scene.onHover = record('hover');
    scene.onSelect = record('select');
    scene.onNavigate = record('navigate');
    scene.onRelayPick = record('relay');
    await scene.load();
    scene.finishOpening(true);
    scene.setHover({ lane: 3, row: 12 });
    scene.navigatePlane({ lane: 3, row: 12 });
    scene.renderer.domElement.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 100, cancelable: true }),
    );
    const value = scene.runtime.options.selectionPulse(1.5, 0.2);
    if (value !== 0.25) throw new Error('自定义波形返回值变化');
    scene.setRelayActive(true);
  });
  try {
    await expect
      .poll(() =>
        page.evaluate(() => window.__callbacks.results.some((item) => item.kind === 'cover')),
      )
      .toBe(true);
    await page.mouse.click(200, 200);
    const results = await page.evaluate(() => window.__callbacks.results);
    for (const kind of ['pulse', 'hover', 'select', 'navigate', 'relay', 'cover']) {
      expect(
        results.some((item) => item.kind === kind),
        kind,
      ).toBe(true);
    }
    expect(results.every((item) => item.owner)).toBe(true);
    expect(results.some((item) => item.kind === 'old-cover')).toBe(false);
    expect(results.find((item) => item.kind === 'pulse')).toMatchObject({
      distance: 1.5,
      age: 0.2,
    });
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.__callbacks.scene.dispose());
  }
});
