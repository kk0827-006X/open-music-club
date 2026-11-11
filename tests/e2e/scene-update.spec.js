const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

// 基线只写入隔离验收产物；普通 CI 没有基线时仍检查真实画面和矩阵有效性。
const comparisonRoot = process.env.OMC_SCENE_BASELINE_DIR;
const captureBaseline = process.env.OMC_SCENE_CAPTURE_BASELINE === '1';
test.use({ deviceScaleFactor: 1 });

for (const viewport of [
  { width: 960, height: 540 },
  { width: 390, height: 844 },
]) {
  test(`场景帧更新画面与矩阵对照 ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    test.setTimeout(300000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__sceneTime = 0;
      Object.defineProperty(performance, 'now', { value: () => window.__sceneTime * 1000 });
      let seed = 7319;
      Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    });
    await page.route('**/scene-update-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:0"><div id="scene" data-entry-phase="entering" data-layout="opening" style="width:100vw;height:100vh"></div></body></html>',
      }),
    );
    await page.goto('/scene-update-fixture');
    const sceneFile = fs
      .readdirSync('frontend/dist/assets')
      .find((file) => /^scene-.*\.js$/.test(file));
    expect(sceneFile).toBeTruthy();
    const frames = await page.evaluate(async (url) => {
      const { ArchiveScene } = await import(url);
      const container = document.querySelector('#scene');
      const scene = new ArchiveScene(container);
      window.__scene = scene;
      // 真实材质及完整 compositor；降低缓冲区尺寸，不替换渲染或场景数学。
      scene.setQuality({
        scale: 75,
        pixelRatio: 1,
        antialias: 'off',
        shadows: 1024,
        aoSamples: 16,
        aoResolution: 0.5,
        depthOfField: 50,
        transmission: 1,
        anisotropy: 1,
      });
      await scene.load();
      scene.resize();
      scene.setTheme(false, true);
      const frames = [];
      const update = (cinematic) => {
        window.__sceneTime += 0.05;
        scene.update(window.__sceneTime, cinematic);
      };
      const advance = (count) => {
        // 中间帧仍运行完整模拟与矩阵更新，只省略 GPU 合成；每个取样帧真实合成全部通道。
        const render = scene.composer.render;
        scene.composer.render = () => {};
        try {
          for (let i = 0; i < count; i++) update();
        } finally {
          scene.composer.render = render;
        }
      };
      const capture = (name, cinematic) => {
        scene.renderState.invalidate();
        update(cinematic);
        const stats = scene.getStats();
        frames.push({
          name,
          image: scene.renderer.domElement.toDataURL('image/png'),
          state: {
            camera: scene.camera.position.toArray(),
            aim: scene.cameraAim.toArray(),
            projection: scene.camera.projectionMatrix.toArray(),
            inverse: scene.camera.matrixWorldInverse.toArray(),
            model: scene.model.matrixWorld.toArray(),
            instances: Array.from(
              scene.instances[0].instanceMatrix.array.slice(0, scene.instances[0].count * 16),
            ),
            covers: scene.coverInstances.map((mesh) => ({
              count: mesh.count,
              matrix: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
            })),
            outgoing: scene.outgoing.map((item) => ({
              cell: { ...item.cell },
              matrix: item.group.matrixWorld.toArray(),
              lift: { ...item.lift },
              clarity: item.clarity,
            })),
            relay: [...scene.relayPoints].map(([key, item]) => [key, item.point.toArray()]),
            decryption: stats.decryption,
            fov: stats.fieldOfView,
            selectedCell: stats.selectedCell,
            extraction: stats.extraction,
            clearance: stats.clearance,
            canInspect: stats.canInspect,
            fog: [stats.fogNear, stats.fogFar],
            archiveCount: stats.archiveCount,
            theme: scene.themeAmount,
            opacity: scene.renderer.domElement.style.opacity,
            composer: scene.composer.passes.map((pass) => ({
              enabled: pass.enabled,
            })),
          },
        });
      };
      capture('01-entry', { time: 22.15, reveal: 0.45, lift: 0, zoom: 0 });
      capture('02-entry-end', { time: 24.9, reveal: 1, lift: 0, zoom: 0 });
      scene.finishOpening(false);
      scene.setOpeningProgress(0.5);
      capture('03-settling');
      container.dataset.entryPhase = 'ready';
      delete container.dataset.layout;
      scene.finishOpening(true);
      advance(30);
      capture('04-preview');
      scene.setHover(scene.selectedCell);
      advance(8);
      capture('05-hover');
      scene.select(8);
      advance(12);
      capture('06-selection-wave');
      scene.setMode('detail');
      advance(80);
      capture('07-detail-decryption');
      advance(80);
      scene.targetRotation = 0.7;
      advance(20);
      capture('08-detail-turn');
      scene.setMode('archive');
      advance(100);
      capture('09-return');
      scene.setTheme(true, true);
      advance(4);
      capture('10-dark');
      scene.setAudioBands({
        low: 0.8,
        mid: 0.45,
        high: 0.2,
        activity: 1,
        spectrum: new Float32Array(64).fill(0.5),
      });
      advance(8);
      capture('11-audio-wave');
      scene.setPlayfield(
        true,
        { low: 0.7, mid: 0.5, high: 0.4, activity: 1, spectrum: new Float32Array(64).fill(0.7) },
        1,
        0.4,
        `${scene.selectedCell.lane}:${scene.selectedCell.row}`,
      );
      scene.setRelayActive(true);
      advance(15);
      capture('12-relay');
      scene.setReduced(true);
      advance(4);
      capture('13-reduced');
      scene.dispose();
      return frames;
    }, `/assets/${sceneFile}`);
    expect(errors).toEqual([]);
    expect(frames).toHaveLength(13);
    const diffs = [];
    for (const frame of frames) {
      const stem = `${viewport.width}-${frame.name}`;
      const png = Buffer.from(frame.image.split(',')[1], 'base64');
      const actual = info.outputPath(`${stem}.png`);
      fs.writeFileSync(actual, png);
      const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const stats = await sharp(png).stats();
      expect(
        Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev)),
        stem,
      ).toBeGreaterThan(2);
      expect(frame.state.archiveCount, stem).toBeGreaterThan(0);
      expect(
        [...frame.state.camera, ...frame.state.projection, ...frame.state.instances].every(
          Number.isFinite,
        ),
        stem,
      ).toBe(true);
      if (!comparisonRoot) continue;
      const baselineImage = path.join(comparisonRoot, `${stem}.png`);
      const baselineState = path.join(comparisonRoot, `${stem}.json`);
      if (captureBaseline) {
        fs.mkdirSync(comparisonRoot, { recursive: true });
        fs.writeFileSync(baselineImage, png);
        fs.writeFileSync(baselineState, JSON.stringify(frame.state));
      } else {
        // 同机同种子以实际像素对照；不更新基线来接受差异。
        // 与保存的 JSON 快照采用同一表示，包括数值等价的 -0 与 0。
        expect(JSON.parse(JSON.stringify(frame.state)), `${stem} 矩阵或场景状态变化`).toEqual(
          JSON.parse(fs.readFileSync(baselineState, 'utf8')),
        );
        const baseline = await sharp(baselineImage)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(decoded.info).toEqual(baseline.info);
        let changed = 0,
          absolute = 0;
        for (let i = 0; i < decoded.data.length; i++) {
          const delta = Math.abs(decoded.data[i] - baseline.data[i]);
          absolute += delta;
          if (delta > 2) changed++;
        }
        const result = {
          frame: stem,
          changedFraction: changed / decoded.data.length,
          meanDifference: absolute / decoded.data.length,
        };
        diffs.push(result);
        expect(result.changedFraction, `${stem} 像素差异`).toBeLessThanOrEqual(0.001);
        expect(result.meanDifference, `${stem} 平均色差`).toBeLessThanOrEqual(0.01);
      }
    }
    await info.attach('像素对照结果', {
      body: JSON.stringify(diffs),
      contentType: 'application/json',
    });
  });
}
