const { test, expect } = require('@playwright/test');
const { installBusinessScene } = require('./business-test');
const { mockWorkspace } = require('./workspace-fixture');

function appearance(panel) {
  return panel.evaluate((node) => {
    const header = node.querySelector('header');
    const row = node.querySelector('[data-queue-key]');
    const cover = row.querySelector('img');
    const button = row.querySelector('[data-queue-play]');
    const read = (element, keys) => {
      const styles = getComputedStyle(element);
      return keys.map((key) => styles.getPropertyValue(key));
    };
    return {
      panel: read(node, [
        'border-radius',
        'border-top-color',
        'background-color',
        'padding',
        'box-shadow',
      ]),
      header: read(header, ['background-color', 'border-bottom-color', 'padding', 'gap']),
      title: read(header.querySelector('strong'), ['font-size', 'letter-spacing']),
      row: read(row, ['min-height', 'padding', 'border-bottom-color', 'gap']),
      number: read(row.firstElementChild, ['display', 'place-items', 'height']),
      cover: read(cover, ['width', 'height', 'object-fit']),
      action: read(button, ['width', 'height', 'padding', 'color']),
    };
  });
}

test('展开播放器、底栏与搜索共用抽屉样式并保留各自的位置', async ({ page, context }) => {
  // 只比较抽屉和真实浏览器布局，图形场景不参与本用例。
  await installBusinessScene(context);
  await mockWorkspace(page);
  for (const { width, height, theme } of [
    { width: 1440, height: 1000, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('omc:theme-preference', { detail })),
      theme,
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const queue = page.locator('[data-player-queue-panel]');
    const closeQueue = queue.getByRole('button', { name: '关闭播放队列' });
    const footerToggle = page.locator('[data-player-queue-toggle]');

    await page.mouse.move(width / 2, height - 2);
    await footerToggle.click();
    await expect(queue.locator('[data-queue-play]').first()).toBeVisible();
    const compactBounds = await queue.boundingBox();
    const compact = await appearance(queue);
    await closeQueue.click();
    await expect(footerToggle).toBeFocused();

    await page.locator(width > 600 ? '[data-player-open]' : '[data-player-open-compact]').click();
    await page.locator('[data-expanded-queue-toggle]').click();
    await expect(closeQueue).toBeFocused();
    const expandedBounds = await queue.boundingBox();
    const expanded = await appearance(queue);
    await expect(queue).toHaveCSS('border-radius', '14px');
    await expect(queue.locator('header')).toHaveCSS('position', 'sticky');
    const queueCloseIcon = closeQueue.locator('span[data-ui-icon="close"]');
    await expect(queueCloseIcon).toHaveText('×');
    expect(compact).toEqual(expanded);
    expect(compactBounds.y).toBeGreaterThan(expandedBounds.y);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await closeQueue.hover();
    await expect(queueCloseIcon).toHaveCSS('animation-name', 'none');
    await expect(queueCloseIcon).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(queueCloseIcon).toHaveCSS('transform', 'none');

    await closeQueue.click();
    await page.locator('[data-player-close]').click();

    await page.locator('[data-nav="search"]').click();
    const input = page.getByRole('searchbox', { name: '搜索音乐' });
    await input.fill('迁移曲目');
    await input.press('Enter');
    const search = page.locator('[data-song-search-panel]');
    const searchClose = search.getByRole('button', { name: '关闭搜索结果' });
    await expect(search.locator('[data-queue-play]').first()).toBeVisible();
    expect(await appearance(search)).toEqual(expanded);
    await expect(searchClose.locator('span[data-ui-icon="close"]')).toHaveText('×');
    const searchBounds = await search.boundingBox();
    expect(searchBounds.y).toBeCloseTo(width > 600 ? 104 : 138, 0);
    expect(searchBounds.x).toBeGreaterThanOrEqual(0);
    expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(width);
    await search.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() =>
        search.evaluate((node) => {
          const panelTop = node.getBoundingClientRect().top;
          return node.querySelector('header').getBoundingClientRect().bottom - panelTop;
        }),
      )
      .toBeLessThanOrEqual(0);
    await search.evaluate((node) => {
      node.scrollTop = 0;
    });
    await searchClose.click();
    await expect(search).toHaveCount(0);
    await expect(page.locator('[data-nav="search"]')).toBeFocused();
  }
});
