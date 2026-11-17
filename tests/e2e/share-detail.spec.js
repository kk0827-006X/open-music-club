const { test, expect } = require('./business-test');
const { useIsolatedBusinessServer } = require('./isolated-server');
useIsolatedBusinessServer(test, 4335);
const { PASSWORD } = require('./fixtures');
test.use({ deviceScaleFactor: 1 });

test('分享详情独立布局、评论分页草稿及两倍 PNG 导出', async ({ page }, info) => {
  const client = page.context().request;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function write(url, data, method = 'post') {
    const csrf = await client.get('/api/security/csrf-token');
    return client[method](url, {
      headers: { Origin: 'http://127.0.0.1:4335', 'X-CSRF-Token': (await csrf.json()).csrfToken },
      data,
    });
  }
  expect((await write('/api/auth/login', PASSWORD)).ok()).toBeTruthy();
  const event = await write('/api/footprint/events', {
    source: 'local',
    sourceId: '1944',
    title: '晚风与远方',
    artist: '隔离歌手',
    durationMs: 210000,
  });
  const eventId = (await event.json()).eventId;
  expect(
    (
      await write(
        `/api/footprint/events/${eventId}/note`,
        { content: '给路上的自己留一句话。' },
        'put',
      )
    ).ok(),
  ).toBeTruthy();
  const card = await write('/api/footprint/cards', {
    title: '在晚风里分享一段音乐回忆',
    eventIds: [eventId],
    style: 'peach',
  });
  const cardId = (await card.json()).card.id;
  const shared = await write('/api/footprint/posts', { cardId, caption: '沿着音乐走向远方。' });
  const id = (await shared.json()).postId;
  for (let i = 0; i < 53; i++)
    expect(
      (await write(`/api/footprint/posts/${id}/comments`, { content: `隔离评论 ${i + 1}` })).ok(),
    ).toBeTruthy();
  await page.route('https://*.music.126.net/**', (route) => route.abort());

  await page.goto('/footprint');
  await page.locator('[data-fp-tab="square"]').click();
  await page.locator(`[data-fp-open-post="${id}"]`).click();
  await expect(page.locator('[data-fp-back]')).toHaveCount(1);
  await expect(page.locator('.fp-detail-head h3')).toHaveText('在晚风里分享一段音乐回忆');
  await expect(page.locator('.fp-comment-list li')).toHaveCount(50);
  await page.getByRole('textbox', { name: '评论内容' }).fill('分页后应保留这份草稿');
  await page.locator('[data-fp-more-comments]').click();
  await expect(page.locator('.fp-comment-list li')).toHaveCount(53);
  await expect(page.getByRole('textbox', { name: '评论内容' })).toHaveValue('分页后应保留这份草稿');
  await expect(page.locator('[data-fp-more-comments]')).toHaveCount(0);

  const height = await page.locator('.fp-detail-card svg').getAttribute('height');
  const pending = page.waitForEvent('download');
  await page.locator('[data-fp-download]').click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await download.saveAs(info.outputPath('card.png'));
  const bytes = require('node:fs').readFileSync(info.outputPath('card.png'));
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(960);
  expect(bytes.readUInt32BE(20)).toBe(Number(height) * 2);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '评论内容' })).toHaveValue('');
  await page.locator('[data-fp-like]').click();
  await expect(page.locator('[data-fp-like]')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail: 'dark' })),
  );
  await page.locator('[data-fp-delete-post]').click();
  await page.locator('[data-fp-dialog-cancel]').click();
  await expect(page.locator('.fp-detail-card svg')).toBeVisible();
  await page.locator('[data-fp-back]').click();
  await expect(page.locator('.fp-square-gallery')).toBeVisible();
  expect(errors).toEqual([]);
});
