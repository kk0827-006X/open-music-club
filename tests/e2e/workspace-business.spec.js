const { test, expect } = require('./business-test');
const { mockWorkspace, openUpload } = require('./workspace-fixture');
const { wave } = require('./fixtures');

test('侧栏键盘收展保留页面实例，窄屏仍可切换功能', async ({ page }) => {
  await mockWorkspace(page);
  for (const name of ['user', 'footprint']) {
    await page.locator(`[data-nav="${name}"]`).click();
    const view = page.locator(`[data-${name}-page]`);
    const layout = view.locator('.sidebar-layout');
    const divider = layout.locator('.sidebar-divider');
    const content = view.locator(name === 'user' ? '.user-content-shell' : '.fp-shell');
    await content.evaluate((node) => {
      node.dataset.retained = 'yes';
    });
    await divider.press('Home');
    await expect(layout).toHaveAttribute('data-collapsed', 'true');
    await divider.press('End');
    await expect(layout).toHaveAttribute('data-collapsed', 'false');
    await expect(content).toHaveAttribute('data-retained', 'yes');
    await page.setViewportSize({ width: 390, height: 844 });
    const item = view.locator('.line-sidebar button').nth(1);
    await item.click();
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(content).toHaveAttribute('data-retained', 'yes');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
});

test('我的上传二级页面保留侧栏与草稿，支持窄屏、返回及重新选择音频', async ({ page }) => {
  await mockWorkspace(page);
  await expect(page.locator('[data-nav="upload"]')).toHaveCount(0);
  await openUpload(page);
  const uploadPage = page.locator('[data-user-page] [data-user-upload-form]');
  await expect(uploadPage).toBeVisible();
  await expect(page).toHaveURL(/\/user\/uploads\/new$/);
  const heading = uploadPage.getByRole('heading', { name: '上传音乐', exact: true });
  await expect(heading).toBeFocused();
  const sidebar = page.locator('[data-user-page] .line-sidebar');
  await expect(sidebar.locator('[data-user-tab="uploads"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sidebar.evaluate((node) => {
    node.dataset.retained = 'true';
  });
  const form = page.locator('[data-upload-form]');
  await expect(form).toBeHidden();
  const input = page.locator('[data-upload-file]');
  await input.setInputFiles({ name: 'isolated.wav', mimeType: 'audio/wav', buffer: wave() });
  await expect(form).toBeVisible();
  await page.locator('[data-upload-remove]').click();
  await expect(form).toHaveAttribute('inert', '');
  await expect(form).toBeHidden();
  await input.setInputFiles({ name: 'again.wav', mimeType: 'audio/wav', buffer: wave() });
  await expect(form).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await uploadPage.locator('[data-upload-title]').fill('保留未提交的标题');
  await uploadPage.getByRole('button', { name: '返回我的上传' }).click();
  await expect(page).toHaveURL(/\/user\/uploads$/);
  const entry = page.locator('[data-user-open-upload]');
  await expect(entry).toBeFocused();
  await expect(uploadPage).toBeHidden();
  await expect(sidebar).toHaveAttribute('data-retained', 'true');
  await entry.click();
  await expect(uploadPage.locator('[data-upload-title]')).toHaveValue('保留未提交的标题');
  await heading.press('Escape');
  await expect(page).toHaveURL(/\/user\/uploads$/);
  await expect(entry).toBeFocused();
});
