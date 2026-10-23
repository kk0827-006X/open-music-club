const { test, expect } = require('@playwright/test')
const { graphicsProfile } = require('./graphics-profile')
test.use({ deviceScaleFactor: 1 })

// 交互回归用合成接口；安全认证和真实音频由 member-journey 独立覆盖。
async function mockWorkspace(page) {
  const tracks = Array.from({ length: 24 }, (_, index) => ({
    source: index % 2 ? 'netease' : 'local', sourceId: String(index + 1),
    trackKey: `${index % 2 ? 'netease' : 'local'}:${index + 1}`,
    title: `迁移曲目 ${index + 1}`, artists: [{ name: '隔离测试歌手' }], album: { name: '隔离专辑' },
    durationMs: 60000, coverUrl: null, playable: true, uploadedBy: { id: 1 },
  }))
  const writes = []
  await page.addInitScript(() => {
    const Original = window.Audio
    window.__migrationAudios = []
    window.Audio = function (...args) { const audio = new Original(...args); window.__migrationAudios.push(audio); return audio }
    window.Audio.prototype = Original.prototype
  })
  await page.route('https://*.music.126.net/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#987654"/></svg>' }))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    let body = { success: true }
    if (url.pathname === '/api/auth/me') body = { authenticated: true, user: { id: 1, email: 'isolated@example.test', role: 'user' } }
    else if (url.pathname === '/api/auth/login') body = { success: true }
    else if (url.pathname === '/api/security/csrf-token') body = { csrfToken: 'isolated-csrf' }
    else if (url.pathname === '/api/me/queue') {
      if (request.method() === 'PUT') writes.push(request.postDataJSON().tracks)
      else body = { tracks }
    } else if (url.pathname === '/api/me/profile') body = { profile: { id: 1, nickname: '隔离成员', avatarUrl: null } }
    else if (url.pathname === '/api/local/music') body = { success: true, tracks: tracks.filter(item => item.source === 'local') }
    else if (url.pathname.startsWith('/api/me/likes/')) body = { liked: false }
    else if (url.pathname === '/api/me/playlists') body = { playlists: [] }
    else if (url.pathname === '/api/me/likes') body = { tracks: [] }
    else if (url.pathname === '/api/footprint/timeline') body = { events: [], total: 0, timezoneOffsetMinutes: 480 }
    else if (url.pathname === '/api/footprint/milestone') body = { milestone: { totalPlays: 0 }, timezoneOffsetMinutes: 480 }
    else if (url.pathname === '/api/footprint/cards') body = { cards: [], total: 0 }
    else if (url.pathname === '/api/footprint/posts') body = { posts: [], total: 0 }
    else if (url.pathname === '/api/footprint/posts/mine') body = { posts: [] }
    else if (url.pathname.includes('/album')) body = { code: 200, songs: [{ id: 900001, name: '专辑测试曲目', dt: 100000 }] }
    else if (url.pathname.includes('/search')) body = { code: 200, result: { songs: [] } }
    await route.fulfill({ json: body })
  })
  await page.route('**/assets/scene-*.js*', route => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('acceptance-original')) return route.continue()
    url.searchParams.set('acceptance-original', '1')
    // 仅测试包装器观察公开渲染器计数，不在生产场景里加入全局调试变量。
    const source = graphicsProfile(url.href).replace('export class ArchiveScene', 'class ProfileScene')
    return route.fulfill({ contentType: 'application/javascript', body: source + `
      export class ArchiveScene extends ProfileScene {
        constructor(...args) {
          super(...args);
          this.probe = { live: true, updates: 0, geometries: 0, textures: 0 };
          (window.__migrationScenes ??= []).push(this.probe);
        }
        update(...args) {
          super.update(...args);
          if (!this.probe) return;
          this.probe.updates++;
          this.probe.geometries = this.renderer.info.memory.geometries;
          this.probe.textures = this.renderer.info.memory.textures;
        }
        dispose() { if (this.probe) this.probe.live = false; super.dispose(); }
      }` })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /点击进入/ }).click()
  await expect(page.locator('[data-album-archive]')).toBeVisible()
  return { writes, tracks }
}

async function showQueue(page) {
  await page.mouse.move(700, 998)
  await expect(page.locator('[data-global-player]')).toHaveClass(/is-visible/)
  await page.locator('[data-player-queue-toggle]').click()
  await expect(page.locator('[data-player-queue-panel]')).toBeVisible()
}
const order = page => page.locator('[data-queue-key]').evaluateAll(rows => rows.map(row => row.dataset.queueKey))

test('LineSidebar 两页复用主题，真实拖拽收展及左缘箭头不丢草稿，窄屏菜单仍可用', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mockWorkspace(page)
  for (const name of ['user', 'footprint']) {
    await page.locator(`[data-nav="${name}"]`).click()
    const view = page.locator(`[data-${name}-page]`)
    await expect(view).toBeVisible()
    const layout = view.locator('.sidebar-layout'), divider = layout.locator('.sidebar-divider')
    const menu = view.locator('.line-sidebar')
    await expect(menu).toBeVisible()
    await expect(menu.locator('.line-sidebar__index')).toHaveCount(0)
    await expect(menu.locator('button[aria-current="page"]')).toHaveCount(1)
    const item = menu.locator('button').nth(1)
    await item.hover()
    await expect.poll(() => item.locator('..').evaluate(node => Number(node.style.getPropertyValue('--effect')))).toBeGreaterThan(.2)
    await item.focus()
    await page.keyboard.press('Enter')
    await expect(item).toHaveAttribute('aria-current', 'page')
    const contentSelector = name === 'user' ? '.user-content-shell' : '.fp-shell'
    await view.locator(contentSelector).evaluate(element => { element.dataset.retained = 'yes' })
    const before = await view.locator(contentSelector).boundingBox()
    const bounds = await divider.boundingBox()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(45, bounds.y + bounds.height / 2, { steps: 24 })
    await page.mouse.up()
    await expect(layout).toHaveAttribute('data-collapsed', 'true')
    await expect(view.locator('aside')).toHaveAttribute('inert', '')
    await expect.poll(async () => (await view.locator(contentSelector).boundingBox()).width).toBeGreaterThan(before.width + 100)
    await expect(view.locator(contentSelector)).toHaveAttribute('data-retained', 'yes')
    await page.mouse.move(1100, 200)
    // 离开竖线后箭头不可见；只在展开入口悬停/聚焦时出现。
    await page.locator('[data-nav="'+name+'"]').focus()
    await expect.poll(() => divider.locator('.sidebar-divider-arrow').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(0)
    await divider.hover()
    await expect.poll(() => divider.locator('.sidebar-divider-arrow').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1)
    await page.screenshot({ path: info.outputPath(`sidebar-${name}-collapsed.png`) })
    await divider.click()
    await expect(layout).toHaveAttribute('data-collapsed', 'false')
    await expect(menu).toBeVisible()
    await expect.poll(async () => Math.abs((await view.locator(contentSelector).boundingBox()).width - before.width)).toBeLessThan(2)
    await divider.focus()
    await page.keyboard.press('Enter')
    await expect(layout).toHaveAttribute('data-collapsed', 'true')
    await page.keyboard.press('Enter')
    await expect(layout).toHaveAttribute('data-collapsed', 'false')
    await expect(view.locator(contentSelector)).toHaveAttribute('data-retained', 'yes')
    await expect.poll(async () => Math.abs((await view.locator(contentSelector).boundingBox()).width - before.width)).toBeLessThan(2)
    await page.screenshot({ path: info.outputPath(`sidebar-${name}-expanded.png`) })
    // 已收起时进入窄屏，菜单不能因 inert 残留而无法操作。
    await divider.press('Home')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(view.locator('aside')).not.toHaveAttribute('inert', '')
    await expect(divider).toBeHidden()
    const mobileItem = menu.locator('button').last()
    await mobileItem.click()
    await expect(mobileItem).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: info.outputPath(`sidebar-${name}-mobile.png`) })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.locator('[data-nav="settings"]').click()
  await page.locator('[data-theme-preference="dark"]').click()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const colors = await page.locator('[data-footprint-page] .line-sidebar').evaluate(element => ({
    accent: getComputedStyle(element).getPropertyValue('--accent-color').trim(),
    site: getComputedStyle(document.documentElement).getPropertyValue('--amber').trim(),
  }))
  expect(colors.accent).toBe(colors.site)
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1)
  expect(errors).toEqual([])
})

test('React 页面反复切换保留实例；队列清空、外部点击、音量和主题不创建新 Audio', async ({ page }, info) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mockWorkspace(page)
  for (let pass = 0; pass < 3; pass++) for (const name of ['search', 'upload', 'user', 'library']) {
    await page.locator(`[data-nav="${name}"]`).click()
    if (name !== 'library') await expect(page.locator(`[data-${name}-page]`)).toBeVisible()
    expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1)
  }
  await showQueue(page)
  await expect(page.locator('[data-queue-key]')).toHaveCount(24)
  // 点击外部导航必须既关闭浮层又完成导航，不允许全屏遮罩吞掉这次点击。
  await page.locator('[data-nav="search"]').click()
  await expect(page.locator('[data-player-queue-panel]')).toBeHidden()
  await expect(page.locator('[data-search-page]')).toBeVisible()
  await page.mouse.move(700, 998)
  const volume = page.getByRole('slider', { name: '音量' })
  await volume.focus()
  await volume.press('Home')
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(0)
  await volume.press('End')
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(1)
  await page.locator('[data-nav="settings"]').click()
  await page.locator('[data-theme-preference="dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1)
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(1)
  await showQueue(page)
  await page.locator('[data-queue-clear]').click()
  await expect(page.locator('[data-player-queue-panel]')).toBeHidden()
  await page.locator('[data-nav="user"]').click()
  await expect(page.locator('[data-user-page]')).toBeVisible()
  await expect(page.locator('[data-queue-count]')).toHaveText('00')
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('react-dark-user.png') })
})

test('Motion 队列真实拖动松手才持久化，取消不提交，长队列边缘可滚动', async ({ page }) => {
  const { writes } = await mockWorkspace(page)
  await showQueue(page)
  const first = page.locator('[data-queue-drag]').first()
  await first.focus()
  await first.press('ArrowDown')
  await expect.poll(() => order(page)).toEqual(['netease:2', 'local:1', ...Array.from({ length: 22 }, (_, i) => `${(i + 2) % 2 ? 'netease' : 'local'}:${i + 3}`)])
  await expect.poll(() => writes.length).toBe(1)
  const before = await order(page)
  const rows = page.locator('[data-queue-key]')
  const start = await page.locator('[data-queue-drag]').first().boundingBox()
  const second = await rows.nth(1).boundingBox()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2, second.y + second.height * .8, { steps: 18 })
  await expect(rows.first()).not.toHaveAttribute('data-queue-key', before[0])
  expect(writes.length).toBe(1, '越过相邻歌曲时只更新 draft，不提前写服务器')
  await page.mouse.up()
  await expect.poll(() => writes.length).toBe(2)
  const committed = await order(page)
  const handle = await page.locator('[data-queue-drag]').first().boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height + 40, { steps: 10 })
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })))
  await page.mouse.up()
  await expect.poll(() => order(page)).toEqual(committed)
  expect(writes.length).toBe(2)
  const panel = page.locator('[data-player-queue-panel]'), bounds = await panel.boundingBox()
  const next = await page.locator('[data-queue-drag]').first().boundingBox()
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2)
  await page.mouse.down()
  for (let i = 0; i < 15; i++) await page.mouse.move(next.x + next.width / 2, bounds.y + bounds.height - 4 - i % 2, { steps: 3 })
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(panel).toBeHidden()
  expect(writes.length).toBe(2, 'Escape 取消不能保存尚未松手的顺序')
})

test('退出重进释放旧场景与音频；后台页面不持续驱动场景，资源不逐轮增长', async ({ page }, info) => {
  await mockWorkspace(page)
  const samples = []
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect.poll(() => page.evaluate(() => window.__migrationScenes?.at(-1)?.geometries || 0), { timeout: 60000 }).toBeGreaterThan(0)
    await page.locator('[data-nav="search"]').click()
    await expect(page.locator('[data-search-page]')).toBeVisible()
    const sample = await page.evaluate(async () => {
      const scene = window.__migrationScenes.at(-1), before = scene.updates
      // 这是明确的 300ms 资源观察窗口，不是用固定等待替代 UI 就绪条件。
      await new Promise(resolve => setTimeout(resolve, 300))
      return { ...scene, hiddenUpdates: scene.updates - before, liveScenes: window.__migrationScenes.filter(item => item.live).length }
    })
    expect(sample.hiddenUpdates).toBe(0)
    expect(sample.liveScenes).toBe(1)
    samples.push(sample)
    if (cycle === 2) break
    await page.locator('[data-nav="settings"]').click()
    await page.locator('[data-settings-category="account"]').click()
    await page.locator('[data-settings-logout]').click()
    await expect(page.locator('[data-login-form]')).toBeVisible()
    expect(await page.evaluate(() => window.__migrationScenes.filter(item => item.live).length)).toBe(0)
    expect(await page.evaluate(() => window.__migrationAudios.every(audio => audio.paused && !audio.getAttribute('src')))).toBe(true)
    await page.locator('#email').fill('isolated@example.test')
    await page.locator('#password').fill('synthetic-secret')
    await page.locator('[data-login-form] [type="submit"]').click()
    await expect(page.locator('[data-album-archive]')).toBeVisible()
  }
  expect(samples.map(sample => sample.geometries)).toEqual(Array(3).fill(samples[0].geometries))
  expect(Math.max(...samples.map(sample => sample.textures)) - Math.min(...samples.map(sample => sample.textures))).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(3)
  await info.attach('react-resource-samples.json', { contentType: 'application/json', body: JSON.stringify(samples, null, 2) })
})

test('默认动效的加号飞行、播放器上推及页面淡出；窄屏与登录玻璃不遮挡操作', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await mockWorkspace(page)
  await page.locator('[data-nav="search"]').click()
  await expect(page.locator('[data-search-page]')).toBeVisible()
  await page.locator('[data-search-results] [data-search-queue]').first().click()
  await expect(page.locator('.queue-add-flight')).toHaveCount(1)
  await expect(page.locator('.queue-add-flight')).toHaveCount(0)
  await page.mouse.move(700, 998)
  await page.locator('[data-player-open]').click()
  await expect(page.locator('[data-player-expanded]')).toHaveClass(/is-open/)
  await expect.poll(() => page.locator('.player-expanded-content').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1)
  const bounds = await page.locator('[data-player-expanded]').boundingBox()
  expect(bounds.y).toBe(0)
  expect(bounds.width).toBe(1440)
  await page.screenshot({ path: info.outputPath('react-expanded-player-motion.png') })
  await page.locator('[data-player-close]').click()
  await page.locator('[data-nav="upload"]').click()
  await expect(page.locator('[data-search-page]')).toBeHidden()
  await expect(page.locator('[data-upload-page]')).toBeVisible()
  await page.screenshot({ path: info.outputPath('react-upload.png') })
  await page.setViewportSize({ width: 800, height: 900 })
  await expect(page.locator('[data-nav="user"]')).toBeInViewport()
  await page.locator('[data-nav="user"]').click()
  await expect(page.locator('[data-user-page]')).toBeVisible()
  await page.screenshot({ path: info.outputPath('react-narrow-user.png') })
  // 沿用原响应式：900px 以下设置入口本就隐藏，恢复桌面后再操作，不改变产品布局。
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('[data-nav="settings"]').click()
  await page.locator('[data-settings-category="account"]').click()
  await page.locator('[data-settings-logout]').click()
  await expect(page.locator('[data-login-form]')).toBeVisible()
  // 可见边界盒不等于入场动画已完成；截图必须等待真实表单透明度达到最终值。
  await expect.poll(() => page.locator('.access-stack').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1)
  await page.locator('#password').fill('synthetic-secret')
  await page.locator('[data-reveal-password]').click()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await expect(page.locator('#password')).toHaveValue('synthetic-secret')
  await page.locator('#password').blur()
  await expect(page.locator('.login-library-glass')).toBeAttached()
  await page.screenshot({ path: info.outputPath('react-login-glass.png') })
  expect(errors).toEqual([])
})
