const { test, expect } = require('./business-test');
const { mockWorkspace } = require('./workspace-fixture');
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

test('上传选择音频显示表单，移除后清空并允许重新选择', async ({ page }) => {
  await mockWorkspace(page);
  await page.locator('[data-nav="upload"]').click();
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
});
