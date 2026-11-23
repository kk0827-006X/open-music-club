const { expect } = require('@playwright/test');
const { graphicsProfile } = require('./graphics-profile');

// 交互回归用合成接口；安全认证和真实音频由 member-journey 独立覆盖。
async function mockWorkspace(
  page,
  role = 'user',
  initialQueue,
  skipAuthorized = false,
  visual = false,
) {
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
    else if (url.pathname === '/api/avatar-studio')
      body = { viewerId: 1, context: 'isolated-avatar-session', outfits: [] };
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
  if (visual)
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

async function showQueue(page) {
  await page.mouse.move(700, 998);
  await expect(page.locator('[data-global-player]')).toHaveClass(/is-visible/);
  await page.locator('[data-player-queue-toggle]').click();
  await expect(page.locator('[data-player-queue-panel]')).toBeVisible();
}
async function openUpload(page) {
  await page.locator('[data-nav="user"]').click();
  await page.locator('[data-user-tab="uploads"]').click();
  await page.locator('[data-user-open-upload]').click();
  await expect(page.locator('[data-user-upload-form]')).toBeVisible();
}
const order = (page) =>
  page
    .locator('[data-player-queue-panel] [data-queue-key]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.queueKey));

module.exports = { mockWorkspace, showQueue, order, openUpload };
