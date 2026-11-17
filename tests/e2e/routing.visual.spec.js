const { test, expect } = require('@playwright/test');
const { graphicsProfile } = require('./graphics-profile');
const { wave } = require('./fixtures');

async function prepare(page, authenticated = true) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const auth = { authenticated };
  await page.route('https://*.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#987654"/></svg>',
    }),
  );
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.__routingAudios = [];
    window.Audio = function (...args) {
      const audio = new Original(...args);
      window.__routingAudios.push(audio);
      return audio;
    };
    window.Audio.prototype = Original.prototype;
  });
  await page.route('**/assets/scene-*.js*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('acceptance-original')) return route.continue();
    url.searchParams.set('acceptance-original', '1');
    return route.fulfill({
      contentType: 'application/javascript',
      body: graphicsProfile(url.href),
    });
  });
  const track = {
    source: 'local',
    sourceId: '1',
    trackKey: 'local:1',
    title: '路由验收音频',
    artists: [{ name: '隔离歌手' }],
    album: { name: '验收' },
    durationMs: 60000,
    coverUrl: null,
    playable: true,
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = { success: true };
    if (url.pathname === '/api/auth/me')
      body = {
        authenticated: auth.authenticated,
        user: auth.authenticated ? { id: 1, email: 'routing@example.test', role: 'user' } : null,
      };
    else if (url.pathname === '/api/auth/login') auth.authenticated = true;
    else if (url.pathname === '/api/auth/logout') auth.authenticated = false;
    else if (url.pathname === '/api/security/csrf-token')
      body = { csrfToken: 'isolated-routing-csrf' };
    else if (url.pathname === '/api/local/music/1/stream')
      return route.fulfill({ contentType: 'audio/wav', body: wave() });
    else if (url.pathname === '/api/me/queue') body = { tracks: [track] };
    else if (url.pathname === '/api/me/profile')
      body = { profile: { id: 1, nickname: '路由验收', avatarUrl: null } };
    else if (url.pathname === '/api/me/playlists') body = { playlists: [] };
    else if (url.pathname === '/api/me/likes') body = { tracks: [] };
    else if (url.pathname.startsWith('/api/me/likes/')) body = { liked: false };
    else if (url.pathname === '/api/local/music') body = { tracks: [] };
    else if (url.pathname === '/api/footprint/timeline')
      body = { events: [], total: 0, timezoneOffsetMinutes: 480 };
    else if (url.pathname.includes('/album')) body = { code: 200, songs: [] };
    await route.fulfill({ json: body });
  });
  return { auth, errors };
}
const view = (page) => page.locator('[data-album-archive]');
async function expectPage(page, name) {
  await expect(page).toHaveURL(new RegExp(`/${name}$`));
  await expect(view(page)).toHaveAttribute('data-view', name === 'library' ? 'archive' : name);
  await expect(view(page)).toHaveAttribute('data-entry-phase', 'ready', { timeout: 60000 });
  if (name !== 'library') await expect(page.locator(`[data-${name}-page]`)).toBeVisible();
  await expect(page.locator('[data-archive-navigation]')).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-archive-navigation]')).not.toHaveAttribute('inert', '');
  await expect(page.locator('[data-nav="library"]')).toBeInViewport();
  await expect(page.locator('[data-entry-start]')).toHaveCount(0);
  await expect(page.locator('[data-authorized-stage]')).toHaveCount(0);
}

test.describe('普通动效下的共享 Dock', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('非音乐库页面直达和刷新不等待隐藏场景，Dock 可见可点击且返回音乐库恢复入场', async ({
    page,
  }) => {
    const { errors } = await prepare(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      false,
    );
    for (const name of ['upload', 'user', 'footprint']) {
      await page.goto(`/${name}`);
      await expectPage(page, name);
      await page.reload();
      await expectPage(page, name);
      await page.locator('[data-nav="settings"]').click();
      await expect(page.locator('[data-settings-dialog]')).toBeVisible();
      await page.locator('[data-settings-close]').click();
    }
    await page.locator('[data-nav="library"]').click();
    await expectPage(page, 'library');
    await page.locator('[data-nav="user"]').click();
    await expectPage(page, 'user');
    expect(await page.evaluate(() => window.__routingAudios.length)).toBe(1);
    expect(errors).toEqual([]);
  });
});
