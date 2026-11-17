const { test, expect } = require('./business-test');
const { useIsolatedBusinessServer } = require('./isolated-server');
useIsolatedBusinessServer(test, 4332);
const { PASSWORD } = require('./fixtures');
test.use({ deviceScaleFactor: 1 });

// 使用真实隔离 SQLite/API/Session，仅替换图形负载与外部封面。
test('卡片工坊独立风格入口创建、修改并在刷新及分享详情中保留', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const client = page.context().request;
  async function write(url, data) {
    const csrf = await client.get('/api/security/csrf-token');
    return client.post(url, {
      headers: { Origin: 'http://127.0.0.1:4332', 'X-CSRF-Token': (await csrf.json()).csrfToken },
      data,
    });
  }
  expect((await write('/api/auth/login', PASSWORD)).ok()).toBeTruthy();
  expect(
    (
      await write('/api/footprint/events', {
        source: 'local',
        sourceId: '123',
        title: '配色验收歌曲',
        artist: '隔离歌手',
        durationMs: 60000,
      })
    ).ok(),
  ).toBeTruthy();
  await page.route('https://*.music.126.net/**', (route) => route.abort());

  await page.goto('/footprint');
  await page.locator('[data-fp-tab="studio"]').click();
  await page.locator('[data-fp-pick]').first().check();
  await page.getByRole('radio', { name: '玫瑰奶昔' }).check();
  await page.locator('[data-fp-generate]').click();
  await expect(page.locator('.fp-card-preview svg')).toHaveAttribute('data-card-palette', 'rose');
  const stored = await (await client.get('/api/footprint/cards')).json();
  const id = stored.cards[0].id;
  await page.getByRole('radio', { name: '薄荷气泡' }).click();
  await expect(page.locator('.fp-card-preview svg')).toHaveAttribute('data-card-palette', 'mint');
  const shared = await write('/api/footprint/posts', { cardId: id, caption: '风格持久化验收' });
  const postId = (await shared.json()).postId;
  await page.reload();
  await page.locator('[data-fp-tab="studio"]').click();
  await page.locator(`[data-fp-open-card="${id}"]`).click();
  await expect(page.getByRole('radio', { name: '薄荷气泡' })).toBeChecked();
  await expect(page.locator('.fp-card-preview svg')).toHaveAttribute('data-card-palette', 'mint');
  expect((await (await client.get(`/api/footprint/posts/${postId}`)).json()).card.data.style).toBe(
    'mint',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('radio', { name: '月光蓝调' }).click();
  await expect(page.locator('.fp-card-preview svg')).toHaveAttribute('data-card-palette', 'sky');

  expect(errors).toEqual([]);
});
