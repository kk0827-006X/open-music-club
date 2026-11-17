const { test, expect } = require('@playwright/test');
const { graphicsProfile } = require('./graphics-profile');
test.use({ deviceScaleFactor: 1 });

// 交互回归用合成接口；安全认证和真实音频由 member-journey 独立覆盖。
async function mockWorkspace(page, role = 'user', initialQueue, skipAuthorized = false) {
  const tracks = Array.from({ length: 24 }, (_, index) => ({
    source: index % 2 ? 'netease' : 'local',
    sourceId: String(index + 1),
    trackKey: `${index % 2 ? 'netease' : 'local'}:${index + 1}`,
    title: `迁移曲目 ${index + 1}`,
    artists: [{ name: '隔离测试歌手' }],
    album: { name: '隔离专辑' },
    durationMs: 60000,
    coverUrl: null,
    playable: true,
    uploadedBy: { id: 1 },
  }));
  const writes = [];
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.__migrationAudios = [];
    window.Audio = function (...args) {
      const audio = new Original(...args);
      window.__migrationAudios.push(audio);
      return audio;
    };
    window.Audio.prototype = Original.prototype;
  });
  await page.route('https://*.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#987654"/></svg>',
    }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let body = { success: true };
    if (url.pathname === '/api/auth/me')
      body = { authenticated: true, user: { id: 1, email: 'isolated@example.test', role } };
    else if (url.pathname === '/api/auth/login') body = { success: true };
    else if (url.pathname === '/api/security/csrf-token') body = { csrfToken: 'isolated-csrf' };
    else if (url.pathname === '/api/me/queue') {
      if (request.method() === 'PUT') writes.push(request.postDataJSON().tracks);
      else body = { tracks: initialQueue ?? tracks };
    } else if (url.pathname === '/api/me/profile')
      body = { profile: { id: 1, nickname: '隔离成员', avatarUrl: null } };
    else if (url.pathname === '/api/local/music')
      body = { success: true, tracks: tracks.filter((item) => item.source === 'local') };
    else if (url.pathname.startsWith('/api/me/likes/')) body = { liked: false };
    else if (url.pathname === '/api/me/playlists') body = { playlists: [] };
    else if (url.pathname === '/api/me/likes') body = { tracks: [] };
    else if (url.pathname === '/api/footprint/timeline')
      body = { events: [], total: 0, timezoneOffsetMinutes: 480 };
    else if (url.pathname === '/api/footprint/milestone')
      body = { milestone: { totalPlays: 0 }, timezoneOffsetMinutes: 480 };
    else if (url.pathname === '/api/footprint/cards') body = { cards: [], total: 0 };
    else if (url.pathname === '/api/footprint/posts') body = { posts: [], total: 0 };
    else if (url.pathname === '/api/footprint/posts/mine') body = { posts: [] };
    else if (url.pathname.includes('/album'))
      body = { code: 200, songs: [{ id: 900001, name: '专辑测试曲目', dt: 100000 }] };
    else if (url.pathname.includes('/search')) body = { code: 200, result: { songs: [] } };
    await route.fulfill({ json: body });
  });
  await page.route('**/assets/scene-*.js*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('acceptance-original')) return route.continue();
    url.searchParams.set('acceptance-original', '1');
    // 仅测试包装器观察公开渲染器计数，不在生产场景里加入全局调试变量。
    const source = graphicsProfile(url.href).replace(
      'export class ArchiveScene',
      'class ProfileScene',
    );
    return route.fulfill({
      contentType: 'application/javascript',
      body:
        source +
        `
      export class ArchiveScene extends ProfileScene {
        constructor(...args) {
          super(...args);
          this.probe = { live: true, updates: 0, geometries: 0, textures: 0 };
          (window.__migrationScenes ??= []).push(this.probe);
        }
        update(...args) {
          // 资源验收要响应晚到的封面；只补真实待上传贴图的渲染，不持续占用软件 GPU。
          if (window.__archiveEntryProbe?.resourceReadiness && this.runtime.assets.coverTextures.some(texture =>
            texture !== this.runtime.assets.fallbackCover && !this.renderer.properties.get(texture).__webglTexture)) this.pendingFrame = true;
          super.update(...args);
          if (!this.probe) return;
          this.probe.updates++;
          this.probe.geometries = this.renderer.info.memory.geometries;
          this.probe.textures = this.renderer.info.memory.textures;
        }
        dispose() { if (this.probe) this.probe.live = false; super.dispose(); }
      }`,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /点击进入/ }).click();
  if (skipAuthorized) await page.getByRole('button', { name: '跳过 SVG 动画，进入系统' }).click();
  await expect(page.locator('[data-album-archive]')).toBeVisible();
  return { writes, tracks };
}

test('wqh 听歌里程设计桌面深色窄屏与正常动效验收', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockWorkspace(page);
  const milestone = {
    totalPlays: 12483,
    totalDurationMs: 189600000,
    distinctTracks: 486,
    distinctArtists: 92,
    activeDays: 68,
    streakDays: 12,
    noteCount: 24,
    firstPlayedAt: '2026-01-10T12:00:00Z',
    busiestDay: { date: '2026-10-12', plays: 92 },
    hourly: Array.from({ length: 24 }, (_, hour) => (hour === 19 ? 95 : 8 + hour * 2)),
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      plays: 80 + i * 14,
      durationMs: 600000,
    })),
    topTracks: Array.from({ length: 5 }, (_, i) => ({
      source: i % 2 ? 'netease' : 'local',
      sourceId: String(i + 1),
      trackKey: `${i % 2 ? 'netease' : 'local'}:${i + 1}`,
      title: ['夜航', '雨落在窗边', '暮色与远方', '风从海上来', '下一站清晨'][i],
      artist: '隔离预览歌手',
      coverUrl: null,
      plays: 60 - i * 8,
      durationMs: 65000,
    })),
  };
  await page.route('**/api/footprint/milestone', (route) => route.fulfill({ json: { milestone } }));
  await page.locator('[data-nav="footprint"]').click();
  await page.locator('[data-fp-tab="milestone"]').click();
  await expect(page.locator('.fp-hero-num')).toContainText('12483');
  await expect(page.locator('.fp-hours-peak-label')).toHaveText('19 点 · 95 次');
  await expect(page.locator('.fp-month')).toHaveCount(12);
  await expect(page.locator('.fp-hours-line')).toHaveCSS('stroke-dashoffset', '0px');
  await page.locator('.fp-hero').screenshot({ path: info.outputPath('milestone-hero-light.png') });
  await page.locator('.fp-milestone').screenshot({ path: info.outputPath('milestone-light.png') });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.locator('.fp-milestone').screenshot({ path: info.outputPath('milestone-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.locator('.fp-shell').evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await page.locator('.fp-milestone').screenshot({ path: info.outputPath('milestone-mobile.png') });
  await page.locator('.fp-top-tracks').scrollIntoViewIfNeeded();
  await page
    .locator('.fp-top-tracks')
    .screenshot({ path: info.outputPath('milestone-ranking-mobile.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-fp-tab="timeline"]').click();
  await page.locator('[data-fp-tab="milestone"]').click();
  await expect(page.locator('.fp-hero-num')).toContainText('12483', { timeout: 5000 });
  await expect(page.locator('.fp-hours-peak-label')).toHaveCSS('opacity', '1');
  await expect(page.locator('.fp-ring-num')).toHaveCSS('opacity', '1');
  await expect(page.locator('.fp-hero-num b')).toHaveCSS('animation-name', 'fp-ms-shine');
  await expect(page.locator('.fp-rank').first()).toHaveCSS('animation-name', 'fp-ms-medal');
  const stat = page.locator('.fp-stat').first();
  await stat.hover();
  await expect(stat).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
  const month = page.locator('.fp-month').first();
  await month.hover();
  await expect(month.locator('i')).toHaveCSS('transform', 'matrix(1, 0, 0, 1.05, 0, 0)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.fp-hero-num b')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.fp-ring-num')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});
