const { test, expect } = require('@playwright/test')
const { generateSync } = require('otplib')
const { ADMIN, MEMBER, wave } = require('./fixtures')

const origin = 'http://127.0.0.1:4317'
async function post(client, url, data) {
  const csrf = await client.get('/api/security/csrf-token')
  expect(csrf.ok()).toBeTruthy()
  return client.post(url, { headers: { Origin: origin, 'X-CSRF-Token': (await csrf.json()).csrfToken }, data })
}
async function loginUi(page) {
  await page.goto('/')
  await page.getByRole('button', { name: /点击进入/ }).click()
  await page.getByLabel(/邮箱地址/).fill(MEMBER.email)
  await page.locator('#password').fill(MEMBER.password)
  await page.getByRole('button', { name: '验证身份', exact: true }).click()
}
async function revealPlayer(page) { await page.mouse.move(700, 998); await expect(page.locator('[data-global-player]')).toHaveClass(/is-visible/) }
async function capture(page, info, name) {
  const path = info.outputPath(name)
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('申请审批 → 密码登录 → 绑定及验证 2FA → 混合队列真实音频播放与恢复', async ({ page, browser }, info) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // 不替换媒体播放实现，只计数真实 Audio；网易云 CDN 内容替换为可解码的合成 WAV。
  await page.addInitScript(() => {
    const Original = window.Audio
    window.__acceptanceAudios = []
    window.Audio = function (...args) { const audio = new Original(...args); window.__acceptanceAudios.push(audio); return audio }
    window.Audio.prototype = Original.prototype
  })
  await page.context().route('https://*.music.126.net/**', route => route.request().url().endsWith('.wav')
    ? route.fulfill({ contentType: 'audio/wav', body: wave() })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#987654"/></svg>' }))
  // CI 无独立 GPU：加载原场景，仅通过既有公开画质接口切换测试配置，不替换模型/交互实现。
  await page.context().route('**/assets/scene-*.js*', route => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('acceptance-original')) return route.continue()
    url.searchParams.set('acceptance-original', '1')
    return route.fulfill({ contentType: 'application/javascript', body: `
      import { ArchiveScene as Original } from ${JSON.stringify(url.href)};
      export class ArchiveScene extends Original {
        constructor(...args) { super(...args); this.setQuality({ scale:50,pixelRatio:1,antialias:'off',shadows:0,aoSamples:0,aoResolution:.5,depthOfField:0,transmission:.25,anisotropy:1 }); }
        async load(...args) { await super.load(...args); this.setSuperPerformance(true); }
      }` })
  })
  const client = page.request
  const adminContext = await browser.newContext({ baseURL: origin })
  try {
    await test.step('申请和审批走现有真实 API（尚无申请/管理 UI）', async () => {
      expect((await client.post('/api/applications', { data: { email: MEMBER.email, nickname: '验收成员' } })).status()).toBe(403)
      const submitted = await post(client, '/api/applications', { email: MEMBER.email, nickname: '验收成员' })
      expect(submitted.status()).toBe(201)
      const id = (await submitted.json()).application.id
      expect((await post(client, '/api/auth/login', MEMBER)).status()).toBe(401)
      expect((await post(client, `/api/admin/applications/${id}/approve`, { initialPassword: MEMBER.password })).status()).toBe(401)
      const admin = adminContext.request
      expect((await post(admin, '/api/auth/login', ADMIN)).status()).toBe(200)
      const setup = await post(admin, '/api/auth/2fa/setup', { password: ADMIN.password })
      const secret = (await setup.json()).secret
      expect((await post(admin, '/api/auth/2fa/confirm', { code: generateSync({ secret }) })).status()).toBe(200)
      expect((await post(admin, `/api/admin/applications/${id}/approve`, { initialPassword: MEMBER.password })).status()).toBe(200)
    })
    let secret, confirmationStep, confirmationCode, recoveryCode
    await test.step('浏览器登录、设置中绑定认证器，密码错误不能绑定', async () => {
      await loginUi(page)
      await expect(page.locator('[data-album-archive]')).toBeVisible()
      // 软件 WebGL 首次加载模型和编译材质比普通 DOM 更新慢，单独等待真实场景就绪。
      await expect.poll(() => page.locator('[data-three-scene]').getAttribute('data-render-quality').then(value => value && JSON.parse(value).superPerformance), { timeout: 60000 }).toBe(true)
      await expect(page.locator('[data-three-scene] canvas')).toBeVisible()
      await page.locator('[data-nav="settings"]').click()
      await page.getByRole('button', { name: '账号与安全', exact: true }).click()
      await page.getByRole('button', { name: '管理 2FA' }).click()
      await page.getByLabel('当前密码').fill('wrong-password')
      await page.getByRole('button', { name: /开始绑定/ }).click()
      await expect(page.locator('[data-factor-status]')).toContainText('验证失败')
      await page.getByLabel('当前密码').fill(MEMBER.password)
      await page.getByRole('button', { name: /开始绑定/ }).click()
      const secretElement = page.locator('.two-factor-secret')
      await expect(secretElement).not.toBeEmpty()
      secret = await secretElement.textContent()
      const confirmationEpoch = Date.now() / 1000
      confirmationStep = Math.floor(confirmationEpoch / 30)
      confirmationCode = generateSync({ secret, epoch: confirmationEpoch })
      await page.getByLabel('认证器验证码').fill(confirmationCode)
      await page.getByRole('button', { name: /确认启用/ }).click()
      await expect(page.locator('.two-factor-codes')).toBeVisible()
      recoveryCode = (await page.locator('.two-factor-codes').textContent()).split('\n')[0]
      await page.getByRole('button', { name: '我已保存恢复码' }).click()
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
      expect((await post(client, '/api/auth/logout', {})).status()).toBe(200)
    })
    await test.step('密码正确仍不能访问音乐，2FA 错码与重放被拒绝', async () => {
      await loginUi(page)
      const dialog = page.locator('[data-login-factor-dialog]')
      await expect(dialog).toBeVisible()
      expect((await client.get('/api/local/music')).status()).toBe(401)
      expect((await client.get('/api/auth/me')).ok()).toBeTruthy()
      expect((await (await client.get('/api/auth/me')).json()).authenticated).toBe(false)
      await dialog.getByLabel('验证码', { exact: true }).fill(generateSync({ secret }) === '000000' ? '999999' : '000000')
      await dialog.getByRole('button', { name: /确认登录/ }).click()
      await expect(dialog.locator('[data-factor-feedback]')).toContainText('验证失败')
      expect((await post(client, '/api/auth/2fa/verify', { code: confirmationCode })).status()).toBe(401)
      // 等待下一真实 TOTP 时间窗，而不是关闭服务端重放检查或写入认证状态。
      await expect.poll(() => Math.floor(Date.now() / 30000), { timeout: 35000, intervals: [250] }).toBeGreaterThan(confirmationStep)
      await capture(page, info, 'two-factor-login.png')
      await dialog.getByLabel('验证码', { exact: true }).fill(generateSync({ secret }))
      await dialog.getByRole('button', { name: /确认登录/ }).click()
      await expect(page.locator('[data-album-archive]')).toBeVisible()
      expect((await client.get('/api/local/music')).status()).toBe(200)
      expect((await client.get('/api/admin/applications')).status()).toBe(403)
    })
    let localId
    await test.step('真实上传、Range 与两种来源加入同一个队列', async () => {
      const token = await (await client.get('/api/security/csrf-token')).json()
      const uploaded = await client.post('/api/local/music', {
        headers: { Origin: origin, 'X-CSRF-Token': token.csrfToken },
        multipart: { title: '验收本地歌曲', artist: '验收歌手', album: '验收专辑', file: { name: 'acceptance.wav', mimeType: 'audio/wav', buffer: wave() } },
      })
      expect(uploaded.status()).toBe(201)
      localId = (await uploaded.json()).track.sourceId
      const range = await client.get(`/api/local/music/${localId}/stream`, { headers: { Range: 'bytes=0-43' } })
      expect(range.status()).toBe(206)
      expect((await range.body()).length).toBe(44)
      await page.locator('[data-nav="search"]').click()
      await page.getByRole('searchbox', { name: '搜索音乐' }).fill('验收')
      await expect(page.locator('[data-search-results] [data-search-queue]')).toHaveCount(2)
      await page.locator(`[data-search-results] [data-search-queue="local:${localId}"]`).click()
      await page.locator('[data-search-results] [data-search-queue="netease:song:900001"]').click()
      await expect.poll(async () => (await (await client.get('/api/me/queue')).json()).tracks?.length).toBe(2)
    })
    await test.step('同一个真实 Audio 依次播放本地与模拟 CDN 音频，歌词同步', async () => {
      await page.locator(`[data-search-results] [data-search-play="local:${localId}"]`).click()
      await expect.poll(() => page.evaluate(() => window.__acceptanceAudios[0]?.currentTime || 0)).toBeGreaterThan(0.1)
      expect(await page.evaluate(() => window.__acceptanceAudios.length)).toBe(1)
      expect(await page.evaluate(() => window.__acceptanceAudios[0].currentSrc)).toContain(`/api/local/music/${localId}/stream`)
      await revealPlayer(page)
      await page.getByRole('button', { name: '下一首', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.__acceptanceAudios[0].currentSrc)).toContain('e2e.music.126.net/audio.wav')
      await expect.poll(() => page.evaluate(() => window.__acceptanceAudios[0].currentTime)).toBeGreaterThan(1.1)
      await revealPlayer(page)
      await page.getByRole('button', { name: '展开播放器与歌词', exact: true }).click()
      await expect(page.locator('[data-expanded-title]')).toHaveText('验收云端歌曲')
      await expect(page.locator('[data-player-lyrics] .is-current')).toContainText('第二句')
      await capture(page, info, 'mixed-queue-lyrics.png')
      expect(await page.evaluate(() => window.__acceptanceAudios.length)).toBe(1)
    })
    await test.step('重新登录仍从数据库恢复混合队列', async () => {
      expect((await post(client, '/api/auth/logout', {})).status()).toBe(200)
      // 用一次性恢复码完成重新登录，避免再等待一个 TOTP 时间窗。
      expect((await post(client, '/api/auth/login', MEMBER)).status()).toBe(200)
      expect((await client.get('/api/me/queue')).status()).toBe(401)
      expect((await post(client, '/api/auth/2fa/recovery', { code: recoveryCode })).status()).toBe(200)
      await page.goto('/')
      await page.getByRole('button', { name: /点击进入/ }).click()
      await expect(page.locator('[data-album-archive]')).toBeVisible()
      await revealPlayer(page)
      await page.locator('[data-player-queue-toggle]').click()
      const queue = page.locator('[data-queue-items]')
      await expect(queue.locator('[data-queue-key]')).toHaveCount(2)
      await expect(queue).toContainText('验收本地歌曲')
      await expect(queue).toContainText('验收云端歌曲')
      await capture(page, info, 'restored-mixed-queue.png')
      expect((await post(client, '/api/auth/logout', {})).status()).toBe(200)
      await post(client, '/api/auth/login', MEMBER)
      expect((await post(client, '/api/auth/2fa/recovery', { code: recoveryCode })).status()).toBe(401)
    })
    expect(errors).toEqual([])
    await info.attach('acceptance-environment.json', { contentType: 'application/json', body: JSON.stringify({
      browserVersion: browser.version(), viewport: page.viewportSize(), deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
      graphicsProfile: '原场景公开接口：50% / superPerformance / 无阴影、AO、景深',
      audio: '真实 HTMLAudioElement；本地受保护流与模拟网易云 CDN',
      database: '独立临时 SQLite；不连接真实账号数据库',
    }, null, 2) })
  } finally { await adminContext.close() }
})
