const { test, expect } = require('./business-test');
const { useIsolatedBusinessServer } = require('./isolated-server');
useIsolatedBusinessServer(test, 4331);
const { AVATAR, AVATAR_OTHER } = require('./fixtures');
test.use({ deviceScaleFactor: 1 });

test('工坊换装配置、自动锁定、保存套用与账号会话隔离', async ({ page, browser }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const client = page.context().request;
  async function write(agent, method, path, data) {
    const token = await agent.get('/api/security/csrf-token');
    return agent[method](path, {
      headers: { Origin: 'http://127.0.0.1:4331', 'X-CSRF-Token': (await token.json()).csrfToken },
      data,
    });
  }
  async function login(agent, account) {
    const response = await write(agent, 'post', '/api/auth/login', account);
    expect(response.status()).toBe(200);
    expect((await response.json()).requiresTwoFactor).not.toBe(true);
    expect((await (await agent.get('/api/auth/me')).json()).authenticated).toBe(true);
  }
  await login(client, AVATAR);
  await page.route('https://*.music.126.net/**', (route) => route.abort());

  await page.goto('/user');
  await expect(page.locator('[data-user-tab="recent"]')).toHaveCount(0);
  await expect(page.locator('.user-sidebar [data-user-tab]')).toHaveCount(4);
  await page.locator('[data-user-tab="avatar"]').click();
  const studio = page.locator('[data-avatar-studio]');
  await expect(studio).toHaveAttribute('data-avatar-view', 'manual');
  await expect(studio.getByText(/仅你可见|仅当前账号可见|CONNECTED|Connected/)).toHaveCount(0);
  await expect(studio.locator('.preview-colors .palette-chip')).toHaveCount(8);
  await expect(studio.locator('.preview-colors .skin-chip')).toHaveCount(4);
  await expect(studio.locator('.preview-colors h2, .preview-colors .hint')).toHaveCount(0);
  await expect(studio.locator('.palette-chip')).toHaveCount(8);
  await expect(studio.locator('.skin-chip')).toHaveCount(4);
  await expect(studio.locator('.slot-card')).toHaveCount(6);
  await expect(studio.locator('[data-avatar-part]')).toHaveCount(59);
  await studio.getByRole('radio', { name: '灰粉主题色' }).click();
  await expect(studio.getByRole('radio', { name: '灰粉主题色' })).toBeChecked();
  await studio.locator('[data-avatar-part="top-shirt"]').click();
  await studio.locator('[data-clear-slot="accessory"]').click();
  async function save(name) {
    await studio.locator('.avatar-save-open').click();
    await page.getByRole('textbox', { name: '形象名称', exact: true }).fill(name);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/avatar-studio/outfits') &&
        response.request().method() === 'POST',
    );
    await page
      .locator('.avatar-source-dialog')
      .getByRole('button', { name: '保存', exact: true })
      .click();
    expect((await saved).status()).toBe(201);
    await expect(page.locator('.avatar-source-dialog')).not.toBeVisible();
    return (await (await client.get('/api/avatar-studio')).json()).outfits.find(
      (item) => item.name === name,
    );
  }
  const saved = await save('原版莫兰迪形象');
  expect(saved.config.top).toBe('top-shirt');
  expect(saved.config.theme).toBe('rose');
  expect(saved.config.accessory).toBeNull();
  const oldContext = (await (await client.get('/api/avatar-studio')).json()).context;
  await studio.locator('[data-avatar-tab="auto"]').click();
  await studio.locator('[data-lock="top"]').click();
  await expect(studio.locator('[data-lock="top"]')).toHaveAttribute('aria-pressed', 'true');
  await studio.locator('[data-preset="stage"]').click();
  await expect(studio.locator('[data-preset="stage"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.locator('.auto-caption')).toContainText('舞台演出');
  await expect(studio.locator('.recent-row')).toHaveCount(1);
  await studio.locator('.avatar-save-open').click();
  await page.getByRole('textbox', { name: '形象名称', exact: true }).fill('切回后保留的草稿');
  await studio.evaluate((node) => {
    node.dataset.preserved = 'yes';
  });
  const another = await page.context().newPage();
  await another.goto('about:blank');
  await another.bringToFront();
  const validated = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/avatar-studio') && response.request().method() === 'GET',
  );
  await page.bringToFront();
  // 无头 Chromium 切标签不一定产生操作系统 focus，显式补发返页事件并保留真实接口校验。
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await validated;
  await expect(studio).toHaveAttribute('data-preserved', 'yes');
  await expect(studio).toHaveAttribute('data-avatar-view', 'auto');
  await expect(studio.locator('[data-preset="stage"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.locator('[data-lock="top"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.avatar-source-dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '形象名称', exact: true })).toHaveValue(
    '切回后保留的草稿',
  );
  await page
    .locator('.avatar-source-dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await another.close();
  await studio.getByRole('button', { name: '一键换装', exact: true }).click();
  await expect(studio.locator('.recent-row')).toHaveCount(2);
  const auto = await save('原版锁定搭配');
  expect(auto.config.top).toBe('top-shirt');
  expect(auto.config.theme).toBe('rose');
  expect(['head-crown', 'head-wing', 'head-pointy', 'head-buns', 'head-long']).toContain(
    auto.config.head,
  );
  await studio.locator('[data-avatar-tab="manual"]').click();
  await studio.getByRole('radio', { name: '雾蓝主题色' }).click();
  await studio.locator('[data-avatar-tab="auto"]').click();
  await studio.locator('.recent-row').first().click();
  await studio.locator('[data-avatar-tab="manual"]').click();
  await expect(studio.getByRole('radio', { name: '灰粉主题色' })).toBeChecked();
  await studio.evaluate((node) => {
    node.scrollTop = 0;
  });

  await studio.locator('[data-avatar-tab="saved"]').click();
  await expect(studio.getByRole('heading', { name: '我的形象', exact: true })).toHaveCount(1);
  await expect(studio.locator('.saved-count')).toContainText('/ 50');
  await expect(studio.getByRole('button', { name: /刷新列表|保存当前形象/ })).toHaveCount(0);
  await expect(studio.locator('.brand-sub, .saved-head, .studio-status, .page-footer')).toHaveCount(
    0,
  );

  const card = studio.locator(`[data-avatar-outfit="${saved.id}"]`);
  await card.getByRole('button', { name: '设为当前' }).click();
  await expect(card.locator('.saved-badge')).toHaveText('当前');
  await card.getByRole('button', { name: '套用', exact: true }).click();
  await expect(studio).toHaveAttribute('data-avatar-view', 'manual');
  await expect(studio.locator('[data-avatar-part="top-shirt"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await page.locator('[data-user-tab="avatar"]').click();
  await expect(studio.getByRole('radio', { name: '灰粉主题色' })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail: 'dark' })),
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await studio.locator('[data-avatar-part="head-short"]').scrollIntoViewIfNeeded();

  await studio.evaluate((node) => {
    node.scrollTop = 0;
  });

  const other = await browser.newContext();
  try {
    await login(other.request, AVATAR_OTHER);
    const privateResponse = await other.request.get('/api/avatar-studio');
    expect(privateResponse.status()).toBe(200);
    const privateState = await privateResponse.json();
    expect(privateState.outfits).toEqual([]);
    expect(
      (
        await write(other.request, 'delete', `/api/avatar-studio/outfits/${saved.id}`, {
          context: privateState.context,
        })
      ).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  async function refreshLibrary() {
    const reading = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/avatar-studio') && response.request().method() === 'GET',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await reading;
  }
  await write(client, 'post', '/api/auth/logout', {});
  await login(client, AVATAR_OTHER);
  await refreshLibrary();
  await expect(studio).toHaveAttribute('data-avatar-view', 'manual');
  await studio.locator('[data-avatar-tab="saved"]').click();
  await expect(studio.locator('[data-avatar-outfit]')).toHaveCount(0);
  expect(
    (
      await write(client, 'delete', `/api/avatar-studio/outfits/${saved.id}`, {
        context: oldContext,
      })
    ).status(),
  ).toBe(409);
  await write(client, 'post', '/api/auth/logout', {});
  await login(client, AVATAR);
  await refreshLibrary();
  await expect(studio).toHaveAttribute('data-avatar-view', 'manual');
  await studio.locator('[data-avatar-tab="saved"]').click();
  const restored = studio.locator(`[data-avatar-outfit="${saved.id}"]`);
  await expect(restored).toContainText('原版莫兰迪形象');
  await restored.getByRole('button', { name: '删除', exact: true }).click();
  await expect(restored.getByRole('button', { name: '确认删除', exact: true })).toBeVisible();
  await expect(restored.getByRole('button', { name: '删除', exact: true })).toBeVisible({
    timeout: 5000,
  });
  await restored.getByRole('button', { name: '删除', exact: true }).click();
  await restored.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(restored).toHaveCount(0);
  await write(client, 'post', '/api/auth/logout', {});
  await refreshLibrary();
  await expect(studio.locator('[data-avatar-status]')).toContainText('登录已失效');
  await expect(studio.locator('[data-avatar-outfit]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
