const { test, expect } = require('@playwright/test');
const { mockWorkspace: prepareWorkspace } = require('./workspace-fixture');
const mockWorkspace = (page) => prepareWorkspace(page, 'user', undefined, false, true);

test('工坊预览对齐、原版色块及窄屏配色', async ({ page }, info) => {
  await mockWorkspace(page);
  await page.locator('[data-nav="user"]').click();
  await page.locator('[data-user-tab="avatar"]').click();
  const studio = page.locator('[data-avatar-studio]');
  const preview = await studio.locator('.preview-stage').boundingBox();
  const equipped = await studio.locator('.preview-meta').boundingBox();
  const swatches = await studio.locator('.preview-colors').boundingBox();
  expect(Math.abs(preview.y - equipped.y)).toBeLessThanOrEqual(1);
  expect(swatches.y).toBeGreaterThanOrEqual(preview.y + preview.height);
  const chip = studio.locator('.palette-chip').first();
  await expect(chip).toHaveCSS('width', '40px');
  await expect(chip).toHaveCSS('height', '40px');
  expect(await chip.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain(
    'linear-gradient',
  );
  await studio.screenshot({ path: info.outputPath('avatar-layout.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail: 'dark' })),
  );
  await expect(studio).toHaveCSS('background-color', 'rgb(236, 229, 218)');
  expect(await studio.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await studio.screenshot({ path: info.outputPath('avatar-layout-mobile.png') });
});

test('时光轴视觉与动态效果', async ({ page }, info) => {
  await mockWorkspace(page);
  await page.route('**/api/footprint/timeline?**', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 1,
            source: 'local',
            sourceId: '1',
            trackKey: 'local:1',
            title: '视觉验收歌曲',
            artist: '隔离歌手',
            album: '隔离专辑',
            coverUrl: null,
            durationMs: 180000,
            playedAt: new Date().toISOString(),
            note: { id: 1, content: '时光轴视觉样本', updatedAt: new Date().toISOString() },
          },
        ],
        total: 1,
        timezoneOffsetMinutes: 480,
      },
    }),
  );
  await page.locator('[data-nav="footprint"]').click();
  const entry = page.locator('.fp-entry').first();
  await expect(entry).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: info.outputPath('timeline-layout.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-fp-tab="milestone"]').click();
  await page.locator('[data-fp-tab="timeline"]').click();
  await expect(entry).toHaveCSS('animation-name', 'fp-timeline-rise');
});

test('真实档案模型首帧与键盘选择', async ({ page }) => {
  await mockWorkspace(page);
  // 软件 WebGL 首次加载模型和编译材质比普通 DOM 更新慢，单独等待真实场景就绪。
  await expect
    .poll(
      () =>
        page
          .locator('[data-three-scene]')
          .getAttribute('data-render-quality')
          .then((value) => value && JSON.parse(value).superPerformance),
      { timeout: 60000 },
    )
    .toBe(true);
  await expect(page.locator('[data-three-scene] canvas')).toBeVisible();
  // 独立验证原模型确实绘制和响应选择，不用仅有 canvas DOM 冒充场景已渲染。
  const scene = page.locator('[data-three-scene]');
  await expect
    .poll(async () => Number(await scene.getAttribute('data-acceptance-frames')))
    .toBeGreaterThan(0);
  const selection = await scene.getAttribute('data-acceptance-selection');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => scene.getAttribute('data-acceptance-selection')).not.toBe(selection);
});
