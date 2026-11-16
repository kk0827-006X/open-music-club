const { test, expect } = require('@playwright/test');
const { PASSWORD } = require('./fixtures');
const { graphicsProfile } = require('./graphics-profile');
test.use({ deviceScaleFactor: 1 });

test('真实广场摘要、统计、本人分页、点赞撤下及固定侧栏入口', async ({ page }, info) => {
  const client = page.context().request;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function write(url, data) {
    const csrf = await client.get('/api/security/csrf-token');
    return client.post(url, {
      headers: { Origin: 'http://127.0.0.1:4317', 'X-CSRF-Token': (await csrf.json()).csrfToken },
      data,
    });
  }
  expect((await write('/api/auth/login', PASSWORD)).ok()).toBeTruthy();
  const event = await write('/api/footprint/events', {
    source: 'local',
    sourceId: '887',
    title: '晚风里的唱片',
    artist: '隔离歌手',
    durationMs: 240000,
  });
  const eventId = (await event.json()).eventId;
  const baseline = (await (await client.get('/api/footprint/overview')).json()).overview;
  for (let i = 0; i < 13; i++) {
    const card = await write('/api/footprint/cards', {
      title: `第 ${i + 1} 段听歌回忆`,
      eventIds: [eventId],
      style: ['rose', 'mint', 'sky', 'lilac', 'amber'][i % 5],
    });
    expect(card.ok()).toBeTruthy();
    expect(
      (
        await write('/api/footprint/posts', {
          cardId: (await card.json()).card.id,
          caption: `晚风与音乐 · ${i + 1}`,
        })
      ).ok(),
    ).toBeTruthy();
  }
  const overview = (await (await client.get('/api/footprint/overview')).json()).overview;
  expect(overview.posts).toBe(baseline.posts + 13);
  const ownTotal = (await (await client.get('/api/footprint/posts/mine?limit=12&offset=0')).json())
    .total;
  await page.route('https://*.music.126.net/**', (route) => route.abort());
  await page.route('**/assets/scene-*.js*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('acceptance-original')) return route.continue();
    url.searchParams.set('acceptance-original', '1');
    return route.fulfill({
      contentType: 'application/javascript',
      body: graphicsProfile(url.href),
    });
  });
  await page.goto('/footprint');
  await page.locator('[data-fp-tab="square"]').click();
  await expect(page.locator('[data-fp-tab="mine"]')).toHaveCount(0);
  await expect(page.locator('[data-fp-open-post]')).toHaveCount(12);
  await expect(page.locator('.fp-post-art')).toHaveCount(12);
  await expect(page.locator('.fp-square-overview dd').first()).toHaveText(String(overview.posts));
  await page.screenshot({ path: info.outputPath('square-desktop.png') });
  await page
    .locator('.fp-post-card')
    .first()
    .screenshot({ path: info.outputPath('square-card.png') });
  await page.locator('[data-fp-filter="mine"]').click();
  await expect(page.locator('[data-fp-tab="square"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-fp-open-post]')).toHaveCount(12);
  await page.locator('[data-fp-more]').click();
  await expect(page.locator('[data-fp-open-post]')).toHaveCount(ownTotal);
  await expect(page.locator('[data-fp-more]')).toHaveCount(0);
  const first = page.locator('.fp-post-card').first();
  await first.locator('[data-fp-like]').click();
  await expect(first.locator('[data-fp-like]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fp-square-overview dd').nth(1)).toHaveText(
    String(overview.likes + 1),
  );
  await first.locator('[data-fp-open-post]').click();
  await expect(page.locator('.fp-detail-card svg')).toBeVisible();
  await page.locator('[data-fp-back]').click();
  await expect(page.locator('[data-fp-filter="mine"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-fp-remove-post]').first().click();
  await page.locator('[data-fp-dialog-cancel]').click();
  await expect(page.locator('.fp-square-overview dd').first()).toHaveText(String(overview.posts));
  await page.locator('[data-fp-remove-post]').first().click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.fp-square-overview dd').first()).toHaveText(
    String(overview.posts - 1),
  );
  await expect(page.locator('.fp-square.fp-square-gallery')).toBeVisible();
  await expect(page.locator('[data-fp-filter="mine"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-fp-tab="mine"]')).toHaveCount(0);
  await expect(page.locator('[data-fp-open-post]')).toHaveCount(12);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail: 'dark' })),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('square-mobile-dark.png') });
  expect(
    await page.locator('.fp-shell').evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  expect(errors).toEqual([]);
});
