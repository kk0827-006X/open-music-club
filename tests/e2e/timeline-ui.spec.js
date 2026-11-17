const { test, expect } = require('./business-test');
const { useIsolatedBusinessServer } = require('./isolated-server');
useIsolatedBusinessServer(test, 4336);
const { PASSWORD } = require('./fixtures');
test.use({ deviceScaleFactor: 1 });

test('时光轴入口、随笔新增修改取消删除', async ({ page }, info) => {
  const client = page.context().request;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function write(url, data, method = 'post') {
    const csrf = await client.get('/api/security/csrf-token');
    return client[method](url, {
      headers: { Origin: 'http://127.0.0.1:4336', 'X-CSRF-Token': (await csrf.json()).csrfToken },
      data,
    });
  }
  expect((await write('/api/auth/login', PASSWORD)).ok()).toBeTruthy();
  const response = await write('/api/footprint/events', {
    source: 'local',
    sourceId: '1888',
    title: '雨后的回声',
    artist: '隔离歌手',
    album: '城市夜行',
    durationMs: 180000,
  });
  const id = (await response.json()).eventId;
  expect(
    (
      await write(
        `/api/footprint/events/${id}/note`,
        { content: '把今晚的雨声留在这首歌里。' },
        'put',
      )
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await write('/api/footprint/events', {
        source: 'netease',
        sourceId: '900001',
        title: '走向清晨',
        artist: '隔离歌手',
        durationMs: 200000,
      })
    ).ok(),
  ).toBeTruthy();
  await page.route('https://*.music.126.net/**', (route) => route.abort());

  await page.goto('/footprint');
  await expect(page.locator('[data-fp-tab]')).toHaveCount(4);
  await expect(page.locator('[data-fp-tab="mine"]')).toHaveCount(0);
  await expect(page.locator('.fp-day-marker h4').first()).toHaveText('今天');
  const entry = page.locator('.fp-entry').filter({ hasText: '雨后的回声' });
  await expect(entry.locator('.fp-note')).toContainText('把今晚的雨声');

  await entry.locator('[data-fp-note-edit]').click();
  await entry.getByRole('textbox', { name: '听歌随笔' }).fill('新的听歌随笔');
  await entry.getByRole('button', { name: '取消', exact: true }).click();
  await expect(entry.locator('.fp-note')).toContainText('把今晚的雨声');
  await entry.locator('[data-fp-note-edit]').click();
  await entry.getByRole('textbox', { name: '听歌随笔' }).fill('新的听歌随笔');
  await entry.getByRole('button', { name: '保存随笔' }).click();
  await expect(entry.locator('.fp-note')).toContainText('新的听歌随笔');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail: 'dark' })),
  );
  await entry.locator('[data-fp-note-delete]').click();
  await expect(entry.locator('.fp-note')).toHaveCount(0);

  await page.locator('[data-fp-tab="milestone"]').click();
  await page.locator('[data-fp-tab="timeline"]').click();

  expect(errors).toEqual([]);
});
