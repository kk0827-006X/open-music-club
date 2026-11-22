const { test, expect } = require('./business-test');
const { mockWorkspace, showQueue, order } = require('./workspace-fixture');
test.use({ deviceScaleFactor: 1 });

test('React 页面反复切换保留实例；队列清空、外部点击、音量和主题不创建新 Audio', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockWorkspace(page);
  for (let pass = 0; pass < 3; pass++)
    for (const name of ['upload', 'user', 'library']) {
      await page.locator(`[data-nav="${name}"]`).click();
      if (name !== 'library') await expect(page.locator(`[data-${name}-page]`)).toBeVisible();
      expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
    }
  await showQueue(page);
  await expect(page.locator('[data-queue-key]')).toHaveCount(24);
  // 点击外部导航必须既关闭浮层又完成导航，不允许全屏遮罩吞掉这次点击。
  await page.locator('[data-nav="upload"]').click();
  await expect(page.locator('[data-player-queue-panel]')).toBeHidden();
  await expect(page.locator('[data-upload-page]')).toBeVisible();
  await page.mouse.move(700, 998);
  const volume = page.getByRole('slider', { name: '音量' });
  await volume.focus();
  await volume.press('Home');
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(0);
  await volume.press('End');
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(1);
  await page.locator('[data-nav="settings"]').click();
  await page.locator('[data-theme-preference="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
  expect(await page.evaluate(() => window.__migrationAudios[0].volume)).toBe(1);
  await showQueue(page);
  await page.locator('[data-queue-clear]').click();
  await expect(page.locator('[data-player-queue-panel]')).toBeHidden();
  await page.locator('[data-nav="user"]').click();
  await expect(page.locator('[data-user-page]')).toBeVisible();
  await expect(page.locator('[data-queue-count]')).toHaveText('00');
  expect(errors).toEqual([]);
});

test('Motion 队列真实拖动松手才持久化，取消不提交，长队列边缘可滚动', async ({ page }) => {
  const { writes } = await mockWorkspace(page);
  await showQueue(page);
  const first = page.locator('[data-queue-drag]').first();
  await first.focus();
  await first.press('ArrowDown');
  await expect
    .poll(() => order(page))
    .toEqual([
      'netease:2',
      'local:1',
      ...Array.from({ length: 22 }, (_, i) => `${(i + 2) % 2 ? 'netease' : 'local'}:${i + 3}`),
    ]);
  await expect.poll(() => writes.length).toBe(1);
  const before = await order(page);
  const rows = page.locator('[data-queue-key]');
  const start = await page.locator('[data-queue-drag]').first().boundingBox();
  const second = await rows.nth(1).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, second.y + second.height * 0.8, { steps: 18 });
  await expect(rows.first()).not.toHaveAttribute('data-queue-key', before[0]);
  expect(writes.length).toBe(1, '越过相邻歌曲时只更新 draft，不提前写服务器');
  await page.mouse.up();
  await expect.poll(() => writes.length).toBe(2);
  const committed = await order(page);
  const handle = await page.locator('[data-queue-drag]').first().boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height + 40, { steps: 10 });
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })),
  );
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(committed);
  expect(writes.length).toBe(2);
  const panel = page.locator('[data-player-queue-panel]'),
    bounds = await panel.boundingBox();
  // 取消后的回位可能短暂把手柄移到吸顶标题下，等待鼠标实际能命中这行。
  await panel.evaluate((node) => {
    node.scrollTop = 0;
  });
  const firstHandle = panel.locator('[data-queue-drag]').first();
  await expect
    .poll(() =>
      firstHandle.evaluate((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }),
    )
    .toBe(true);
  const next = await firstHandle.boundingBox();
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 15; i++)
    await page.mouse.move(next.x + next.width / 2, bounds.y + bounds.height - 4 - (i % 2), {
      steps: 3,
    });
  await expect(panel.locator('[data-queue-items]')).toHaveClass('is-dragging');
  await expect.poll(() => panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(panel).toBeHidden();
  expect(writes.length).toBe(2, 'Escape 取消不能保存尚未松手的顺序');
});

test('长队列定位末尾当前歌曲只滚动抽屉，打开和关闭不移动播放器', async ({ page }) => {
  await mockWorkspace(page);
  await page.route('https://e2e.music.126.net/queue-scroll.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: require('./fixtures').wave() }),
  );
  await page.route('**/api/netease/song/url/v1?**', (route) =>
    route.fulfill({
      json: { code: 200, data: [{ url: 'https://e2e.music.126.net/queue-scroll.wav' }] },
    }),
  );
  await showQueue(page);
  await page.locator('[data-queue-play="netease:24"]').click();
  await page.keyboard.press('Escape');
  await page.mouse.move(700, 998);
  await page.locator('[data-player-open]').click();
  await expect(page.locator('[data-expanded-title]')).toHaveText('迁移曲目 24');

  const track = page.locator('.player-expanded-track');
  const before = await track.boundingBox();
  const outerScroll = () => page.locator('.album-archive').evaluate((node) => node.scrollTop);
  const scrollBefore = await outerScroll();
  await page.locator('[data-expanded-queue-toggle]').click();
  const drawer = page.locator('[data-player-queue-panel]');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[data-queue-close]')).toBeFocused();
  await expect
    .poll(() =>
      drawer.evaluate((node) => {
        const row = node.querySelector('li.is-active').getBoundingClientRect();
        const panel = node.getBoundingClientRect();
        return (
          node.scrollTop > 0 &&
          row.top >= node.querySelector('header').getBoundingClientRect().bottom &&
          row.bottom <= panel.top + node.clientTop + node.clientHeight
        );
      }),
    )
    .toBe(true);
  expect(await outerScroll()).toBe(scrollBefore);
  expect(await track.boundingBox()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.locator('[data-expanded-queue-toggle]')).toBeFocused();
  expect(await outerScroll()).toBe(scrollBefore);
  expect(await track.boundingBox()).toEqual(before);
});

test('用户左侧栏进入审核不重载、不重播授权动画，保留队列与同一音频', async ({ page }, info) => {
  await mockWorkspace(page, 'admin');
  await page.route('**/api/admin/applications?**', (route) =>
    route.fulfill({
      json: {
        success: true,
        total: 1,
        applications: [
          {
            id: 81,
            nickname: '左侧栏审核验收',
            reason: '检查原页面内切换',
            status: 'pending',
            emailVerified: false,
            canReview: true,
            canResendActivation: false,
            activationMailStatus: null,
            createdAt: '2026-10-27T00:00:00Z',
            reviewedAt: null,
            reviewedBy: null,
            activatedAt: null,
            notificationStatus: 'delivered',
          },
        ],
      },
    }),
  );
  await page.locator('[data-nav="user"]').click();
  const side = page.locator('.user-sidebar');
  await expect(side.locator('[data-user-tab="admin"]')).toBeVisible();
  await expect(side.locator('.line-sidebar__item').last()).toContainText('申请审核');
  await expect(page.locator('[data-archive-navigation] .application-admin-entry')).toHaveCount(0);
  const before = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    audio: window.__migrationAudios.length,
    url: location.href,
  }));
  const queueCount = await page.locator('[data-queue-count]').textContent();
  await page.evaluate(() => {
    window.__replayedAuthorization = false;
    window.__reviewNavigationObserver = new MutationObserver(() => {
      if (document.querySelector('[data-authorized-stage]')) window.__replayedAuthorization = true;
    });
    window.__reviewNavigationObserver.observe(document.body, { childList: true, subtree: true });
  });
  await side.locator('[data-user-tab="admin"]').click();
  const panel = page.locator('[data-admin-applications]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.archive-brand')).toHaveCount(0);
  await panel.getByRole('button', { name: /左侧栏审核验收/ }).click();
  await panel.getByRole('button', { name: '通过审核', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认通过申请？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '确认通过申请？' })).not.toBeVisible();
  await expect(page.locator('[data-album-archive]')).toHaveAttribute('data-view', 'user');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  await side.locator('[data-user-tab="playlists"]').click();
  await expect(page.locator('[data-user-create]')).toBeVisible();
  await expect(panel).toHaveCount(0);
  await side.locator('[data-user-tab="admin"]').click();
  await expect(panel).toBeVisible();
  expect(await page.locator('[data-queue-count]').textContent()).toBe(queueCount);
  expect(
    await page.evaluate(() => ({
      timeOrigin: performance.timeOrigin,
      audio: window.__migrationAudios.length,
      url: location.href,
    })),
  ).toEqual(before);
  expect(await page.evaluate(() => window.__replayedAuthorization)).toBe(false);
  await page.evaluate(() => window.__reviewNavigationObserver.disconnect());
  await page.setViewportSize({ width: 390, height: 844 });
});

test('歌单散放卡片首屏显示封面，拖动不进入详情，点击、键盘与窄屏所有歌单同页可用', async ({
  page,
}, info) => {
  await mockWorkspace(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const lists = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    name: `唱片档案 ${index + 1}`,
    trackCount: 1,
    coverUrl: `https://p.music.126.net/playlist-${index + 1}.svg`,
    createdAt: '',
    updatedAt: '',
  }));
  let detailCalls = 0;
  await page.route('**/api/me/playlists**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me/playlists') return route.fulfill({ json: { playlists: lists } });
    detailCalls++;
    return route.fulfill({
      json: {
        playlist: lists.find((list) => list.id === Number(url.pathname.split('/').at(-1))),
        tracks: [],
      },
    });
  });
  await page.locator('[data-nav="user"]').click();
  await expect(page.locator('[data-user-list]')).toHaveCount(6);
  for (let id = 1; id <= 6; id++) {
    const image = page.locator(`[data-user-list="${id}"] img`);
    await expect(image).toHaveAttribute('src', `https://p.music.126.net/playlist-${id}.svg`);
    await expect
      .poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0))
      .toBe(true);
  }
  expect(detailCalls).toBe(0);
  const card = page.locator('[data-user-list="3"]');
  await card.focus();
  // 随机重叠与三维旋转会让边界盒内的点落在另一张卡片上；先确认真实命中目标。
  let start;
  await expect
    .poll(async () => {
      start = await card.evaluate((node) => {
        const box = node.getBoundingClientRect();
        for (const horizontal of [0.5, 0.35, 0.65]) {
          for (const vertical of [0.5, 0.35, 0.65]) {
            const x = box.x + box.width * horizontal,
              y = box.y + box.height * vertical;
            if (node.contains(document.elementFromPoint(x, y))) return { x, y, beforeX: box.x };
          }
        }
        return null;
      });
      return Boolean(start);
    })
    .toBe(true);
  await page.mouse.move(start.x, start.y);
  await expect
    .poll(() =>
      card.evaluate(
        (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
        start,
      ),
    )
    .toBe(true);
  await page.mouse.down();
  await page.mouse.move(start.x - 65, start.y + 22, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await card.boundingBox()).x - start.beforeX))
    .toBeGreaterThan(30);
  expect(detailCalls).toBe(0);

  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-user-back]')).toBeVisible();
  await expect.poll(() => detailCalls).toBe(1);
  await page.locator('[data-user-back]').click();
  await expect(page.locator('[data-user-list="3"]')).toBeEnabled();
  // 先将目标置顶，避免随机重叠的其他卡片挡住本次普通点击验收。
  await page.locator('[data-user-list="3"]').focus();
  await page.locator('[data-user-list="3"]').click();
  await expect(page.locator('[data-user-back]')).toBeVisible();
  await page.locator('[data-user-back]').click();
  await expect(page.locator('[data-user-list="3"]')).toBeEnabled();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-user-list="3"]')).toBeVisible();
  await expect(page.locator('[data-user-create]')).toBeInViewport();
  const board = page.locator('[data-playlist-deck]');
  // 在同一帧采样全部边界，等待侧栏响应式过渡完成，不能混用不同帧的坐标。
  await expect
    .poll(() =>
      board.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return [...node.querySelectorAll('[data-draggable-card]')].every((card) => {
          const box = card.getBoundingClientRect();
          return box.left >= bounds.left - 4 && box.right <= bounds.right + 4;
        });
      }),
    )
    .toBe(true);

  await expect(page.locator('[data-user-list]')).toHaveCount(6);
  await expect(page.locator('[data-user-page-step]')).toHaveCount(0);
  await expect
    .poll(() =>
      board.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return [...node.querySelectorAll('[data-draggable-card]')].slice(3).every((card) => {
          const box = card.getBoundingClientRect();
          return box.top >= bounds.top - 4 && box.bottom <= bounds.bottom + 4;
        });
      }),
    )
    .toBe(true);
  await page.locator('[data-user-list="6"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-user-back]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('窄屏收起播放器后返回可见入口并可用键盘重开', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockWorkspace(page);
  await page.mouse.move(120, 638);
  await page.locator('[data-player-open-compact]').click();
  await expect(page.locator('[data-player-close]')).toBeFocused();
  await page.locator('[data-player-close]').click();
  await expect(page.locator('[data-player-open-compact]')).toBeFocused();
  await page.locator('[data-player-open-compact]').press('Enter');
  await expect(page.locator('[data-player-close]')).toBeFocused();
});

test('长歌词自动定位和首尾滚轮只滚动歌词容器，播放器与外层页面保持原位', async ({ page }, info) => {
  await mockWorkspace(page, 'user', []);
  const lines = Array.from(
    { length: 56 },
    (_, i) =>
      `[00:${String(i).padStart(2, '0')}.00]第 ${i} 句歌词，用长文本检查换行、跟随和滚动边界，播放器应始终保持原位`,
  ).join('\n');
  await page.route('**/api/netease/search?**', (route) =>
    route.fulfill({
      json: {
        code: 200,
        result: {
          songs: [
            {
              id: 611,
              name: '滚动隔离测试',
              ar: [{ name: '隔离歌手' }],
              al: { name: '隔离专辑' },
              dt: 60000,
            },
          ],
        },
      },
    }),
  );
  await page.route('**/api/netease/song/url/v1?**', (route) =>
    route.fulfill({ json: { code: 200, data: [{ url: 'https://e2e.music.126.net/scroll.wav' }] } }),
  );
  const media = require('./fixtures').wave();
  await page.route('https://e2e.music.126.net/scroll.wav', async (route) => {
    // 模拟媒体也支持范围读取，保证跳转到后半段时使用真实 seek，而非被浏览器重置到零。
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
      },
      body: media.subarray(start, end + 1),
    });
  });
  await page.route('**/api/netease/lyric?**', (route) =>
    route.fulfill({ json: { code: 200, lrc: { lyric: lines } } }),
  );
  await page.locator('[data-nav="search"]').click();
  await page.getByRole('searchbox', { name: '搜索音乐' }).fill('滚动隔离');
  await page.getByRole('searchbox', { name: '搜索音乐' }).press('Enter');
  await page.getByRole('button', { name: '播放 滚动隔离测试', exact: true }).click();
  await page.mouse.move(700, 998);
  await page.locator('[data-player-open]').click();

  await expect(page.locator('[data-player-lyrics] p')).toHaveCount(56);
  await page.locator('[data-expanded-toggle]').click();
  await expect.poll(() => page.evaluate(() => window.__migrationAudios[0].paused)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ranges = window.__migrationAudios[0].seekable;
        return ranges.length ? ranges.end(ranges.length - 1) : 0;
      }),
    )
    .toBeGreaterThan(55);
  const outer = () =>
    page.evaluate(() => {
      const lyric = document.querySelector('[data-player-lyrics]');
      const ancestors = [];
      for (let node = lyric.parentElement; node; node = node.parentElement) {
        ancestors.push({
          name: node.className || node.tagName,
          top: node.scrollTop,
          left: node.scrollLeft,
        });
      }
      return {
        ancestors,
        x: scrollX,
        y: scrollY,
        playerTop: document.querySelector('[data-player-expanded]').getBoundingClientRect().top,
        coverTop: document.querySelector('[data-expanded-cover]').getBoundingClientRect().top,
      };
    });
  const seek = async (second) => {
    await page.evaluate((time) => {
      const audio = window.__migrationAudios[0];
      audio.currentTime = time + 0.05;
    }, second);
    await expect
      .poll(() => page.evaluate(() => window.__migrationAudios[0].currentTime))
      .toBeCloseTo(second + 0.05, 1);
    await expect(page.locator('[data-player-lyrics] .is-current')).toContainText(`第 ${second} 句`);
  };
  const lyrics = page.locator('[data-player-lyrics]');
  for (const [width, height, reducedMotion] of [
    [1440, 1000, 'no-preference'],
    [390, 844, 'reduce'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion });
    const baseline = await outer();
    expect(baseline.playerTop).toBe(0);
    await seek(45);
    await expect.poll(() => lyrics.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    // 等真实平滑定位完成，再验证手动滚动，避免两次滚动在同一帧竞争。
    await expect
      .poll(() =>
        lyrics.evaluate((node) => {
          const line = node.querySelector('.is-current').getBoundingClientRect();
          return Math.abs(
            line.top +
              line.height / 2 -
              node.getBoundingClientRect().top -
              node.clientTop -
              node.clientHeight / 2,
          );
        }),
      )
      .toBeLessThan(2);
    expect(await outer()).toEqual(baseline);
    const box = await lyrics.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100000);
    await expect
      .poll(() =>
        lyrics.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
      )
      .toBeLessThan(2);
    await page.mouse.wheel(0, 1000);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await outer()).toEqual(baseline);
    // 连续滚轮输入覆盖滚动惯性和方向反转，并逐次检查外层未被带动。
    for (let gesture = 0; gesture < 8; gesture++) {
      await page.mouse.wheel(0, -5000);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      expect(await outer()).toEqual(baseline);
    }
    await expect.poll(() => lyrics.evaluate((node) => node.scrollTop)).toBe(0);
    await page.mouse.wheel(0, -1000);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(await outer()).toEqual(baseline);
    await seek(8);
    await expect.poll(() => lyrics.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect
      .poll(() =>
        lyrics.evaluate((node) => {
          const line = node.querySelector('.is-current').getBoundingClientRect();
          return Math.abs(
            line.top +
              line.height / 2 -
              node.getBoundingClientRect().top -
              node.clientTop -
              node.clientHeight / 2,
          );
        }),
      )
      .toBeLessThan(2);
    expect(await outer()).toEqual(baseline);
  }
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
});

test.describe('完整播放器 Wake Slider', () => {
  test.use({ hasTouch: true });
  test('仅替换展开页音量，键盘鼠标触屏同步原音频，保留迷你播放器', async ({ page }, info) => {
    await mockWorkspace(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const initial = await page.evaluate(() => ({
      count: window.__migrationAudios.length,
      src: window.__migrationAudios[0].src,
      paused: window.__migrationAudios[0].paused,
    }));
    await page.mouse.move(700, 998);
    await page.locator('[data-player-open]').click();
    const wake = page.locator('.expanded-player-volume .wake-slider');
    const handle = wake.getByRole('slider', { name: '音量' });
    const audioVolume = () => page.evaluate(() => window.__migrationAudios[0].volume);
    await expect(wake).toBeVisible();
    await expect(wake.locator('.wake-slider__bar')).toHaveCount(28);
    await expect(page.locator('[data-global-player] .wake-slider')).toHaveCount(0);
    await expect(page.locator('[data-player-volume-input]')).toHaveClass(
      /player-volume-slider-thumb/,
    );
    await handle.press('Home');
    await expect.poll(audioVolume).toBe(0);
    await expect(wake.locator('[data-on="true"]')).toHaveCount(0);
    await handle.press('End');
    await expect.poll(audioVolume).toBe(1);
    await expect(wake.locator('[data-on="true"]')).toHaveCount(28);

    const track = wake.locator('.wake-slider__track');
    const box = await track.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(audioVolume).toBeCloseTo(0.8, 1);
    await page.locator('[data-player-close]').click();
    const mini = page.locator('[data-player-volume-input]');
    await expect(page.locator('[data-global-player]')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-player-open]')).toBeFocused();
    await expect(mini).toBeVisible();
    await mini.focus();
    await expect(mini).toBeFocused();
    const before = await audioVolume();
    await mini.press('ArrowLeft');
    await expect.poll(audioVolume).toBeCloseTo(before - 0.01);
    await page.locator('[data-player-open]').click();
    await expect(handle).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((before - 0.01) * 100)),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const touchBox = await track.boundingBox();
    const session = await page.context().newCDPSession(page);
    const point = (fraction) => ({
      x: touchBox.x + touchBox.width * fraction,
      y: touchBox.y + touchBox.height / 2,
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(0.15)],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(0.75)],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect.poll(audioVolume).toBeCloseTo(0.75, 1);
    await expect(wake).toBeInViewport();
    await expect(page.locator('[data-expanded-queue-toggle]')).toBeInViewport();

    expect(
      await page.evaluate(() => ({
        count: window.__migrationAudios.length,
        src: window.__migrationAudios[0].src,
        paused: window.__migrationAudios[0].paused,
      })),
    ).toEqual(initial);
    expect(errors).toEqual([]);
  });
});

test('专辑播放全部替换旧队列，从第一首开播并顺序切歌，不创建第二个音频实例', async ({
  page,
}, info) => {
  const { writes } = await mockWorkspace(page);
  let releaseAlbum;
  const albumGate = new Promise((resolve) => {
    releaseAlbum = resolve;
  });
  await page.route('**/api/netease/album?**', async (route) => {
    await albumGate;
    await route.fulfill({
      json: {
        code: 200,
        songs: [
          { id: 910001, name: '整专第一首', dt: 60000 },
          { id: 910002, name: '整专第二首', dt: 60000 },
        ],
      },
    });
  });
  await page.route('**/api/netease/song/url/v1?**', (route) =>
    route.fulfill({
      json: { code: 200, data: [{ url: 'https://e2e.music.126.net/album-all.wav' }] },
    }),
  );
  await page.route('https://e2e.music.126.net/album-all.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: require('./fixtures').wave() }),
  );
  await expect(page.locator('[data-album-archive]')).toHaveAttribute('data-entry-phase', 'ready', {
    timeout: 45000,
  });
  // 图形点击边界由替身发出选择事件，后续详情、播放和队列仍走真实页面逻辑。
  await page.evaluate(() => window.__businessScenes.at(-1).onSelect(0, { row: 0, lane: 0 }));
  await page.locator('[data-open-selected]').click();

  const button = page.locator('[data-album-play-all]');
  await expect(button).toBeVisible();

  await expect(button).toBeDisabled();
  releaseAlbum();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('[data-player-track] strong')).toHaveText('整专第一首');
  await expect.poll(() => page.evaluate(() => window.__migrationAudios[0].paused)).toBe(false);
  await expect
    .poll(() => writes.at(-1))
    .toEqual([
      { source: 'netease', sourceId: '910001' },
      { source: 'netease', sourceId: '910002' },
    ]);
  await showQueue(page);
  await expect.poll(() => order(page)).toEqual(['netease:910001', 'netease:910002']);
  await page.evaluate(() => window.__migrationAudios[0].dispatchEvent(new Event('ended')));
  await expect(page.locator('[data-player-track] strong')).toHaveText('整专第二首');
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
});

test('统一歌曲搜索合并分页，直接播放和加入歌单不覆盖真实队列，旧查询不覆盖新查询', async ({
  page,
}, info) => {
  const { writes, tracks: originalQueue } = await mockWorkspace(page);
  const songs = (id) => ({
    id,
    name: `合并歌曲${id}`,
    ar: [{ name: '歌手' }],
    al: { name: '专辑' },
    dt: 60000,
  });
  const saves = [];
  let releaseOld;
  const oldGate = new Promise((resolve) => {
    releaseOld = resolve;
  });
  await page.route('**/api/netease/search?**', async (route) => {
    const url = new URL(route.request().url()),
      type = url.searchParams.get('type'),
      old = url.searchParams.get('keywords') === '旧';
    if (old) await oldGate;
    const result =
      type === '100'
        ? { artists: [{ id: 101, name: '歌手' }] }
        : type === '10'
          ? { albums: [{ id: 202, name: '专辑' }] }
          : {
              songs: [
                songs(url.searchParams.get('offset') === '0' ? 910001 : 910005),
                songs(910002),
              ],
              songCount: 31,
            };
    await route.fulfill({ json: { code: 200, result } }).catch(() => {});
  });
  await page.route('**/api/netease/artist/songs?**', (route) =>
    route.fulfill({ json: { code: 200, songs: [songs(910001), songs(910003)], more: false } }),
  );
  await page.route('**/api/netease/album?**', (route) =>
    route.fulfill({ json: { code: 200, songs: [songs(910004)] } }),
  );
  const coverBatches = [];
  await page.route('**/api/netease/song/detail?**', async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids').split(',');
    coverBatches.push(ids);
    await route.fulfill({
      json: {
        code: 200,
        songs: ids.map((id) => ({
          id: Number(id),
          al: { picUrl: `http://p3.music.126.net/p2-search-${id}.svg` },
        })),
      },
    });
  });
  await page.route('https://p3.music.126.net/p2-search-*.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#a65"/></svg>',
    }),
  );
  await page.route('**/api/netease/song/url/v1?**', (route) =>
    route.fulfill({
      json: { code: 200, data: [{ url: 'https://e2e.music.126.net/unified.wav' }] },
    }),
  );
  await page.route('https://e2e.music.126.net/unified.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: require('./fixtures').wave() }),
  );
  await page.route('**/api/me/playlists**', async (route) => {
    if (route.request().method() === 'POST') {
      saves.push(route.request().postDataJSON());
      await route.fulfill({ json: { success: true } });
    } else
      await route.fulfill({ json: { playlists: [{ id: 7, name: '测试歌单', trackCount: 0 }] } });
  });
  await expect(page.locator('[data-album-archive]')).toHaveAttribute('data-entry-phase', 'ready', {
    timeout: 45000,
  });
  await page.locator('[data-nav="search"]').click();
  const input = page.getByRole('searchbox', { name: '搜索音乐' });
  await expect(input).toBeFocused();
  await input.fill('旧');
  await input.press('Enter');
  await input.fill('新');
  await input.press('Enter');
  const panel = page.locator('[data-song-search-panel]');
  await expect(panel.locator('[data-queue-key]')).toHaveCount(4);
  const completedCover = panel.locator('[data-queue-key="netease:910001"] img');
  await expect(completedCover).toHaveAttribute(
    'src',
    'https://p3.music.126.net/p2-search-910001.svg',
  );
  await expect
    .poll(() => completedCover.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  releaseOld();
  await expect(panel.locator('[data-queue-key]')).toHaveCount(4);
  await expect(
    panel.locator('[data-queue-clear], [data-queue-remove], [data-queue-like]'),
  ).toHaveCount(0);
  const more = panel.getByRole('button', { name: '加载更多歌曲' });
  await expect(more).toHaveText('more');

  await more.click();
  await expect(panel.locator('[data-queue-key]')).toHaveCount(5);
  expect(coverBatches).toEqual([['910001', '910002', '910003', '910004'], ['910005']]);
  const originalRefs = originalQueue.map(({ source, sourceId }) => ({ source, sourceId }));
  for (const snapshot of writes) expect(snapshot).toEqual(originalRefs);
  await panel.locator('[data-queue-play="netease:910001"]').click();
  await expect(page.locator('[data-player-track] strong')).toHaveText('合并歌曲910001');
  await panel.locator('[data-queue-save="netease:910001"]').click();
  const dialog = page.locator('[data-collection-dialog]');
  await expect(dialog).toBeVisible();
  await dialog.locator('select').selectOption('7');
  await dialog.getByRole('button', { name: /保存到歌单/ }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toEqual({ source: 'netease', sourceId: '910001' });
  await expect
    .poll(() => writes.at(-1))
    .toEqual([...originalRefs, { source: 'netease', sourceId: '910001' }]);
  await expect(page.locator('[data-album-archive]')).toHaveAttribute('data-view', 'archive');
  await expect(page.locator('[data-search-page]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);

  await expect(panel).toHaveCount(0);
});

test('用户页拆分后创建、重命名取消与保存、删除确认及头像上传保持原行为', async ({ page }) => {
  await mockWorkspace(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let lists = [];
  let profile = { id: 1, nickname: '隔离成员', avatarUrl: null };
  const writes = [];
  await page.route('**/api/me/profile', (route) => route.fulfill({ json: { profile } }));
  await page.route('**/api/me/playlists**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      return route.fulfill({
        json:
          url.pathname === '/api/me/playlists'
            ? { playlists: lists }
            : { playlist: lists[0], tracks: [] },
      });
    }
    writes.push(request.method());
    expect(request.headers()['x-csrf-token']).toBe('isolated-csrf');
    if (request.method() === 'POST')
      lists = [{ id: 1, name: request.postDataJSON().name, trackCount: 0 }];
    if (request.method() === 'PATCH') lists[0].name = request.postDataJSON().name;
    if (request.method() === 'DELETE') lists = [];
    return route.fulfill({ json: { success: true, playlist: lists[0] } });
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSocAAAAASUVORK5CYII=',
    'base64',
  );
  let avatarUploads = 0;
  await page.route('**/api/me/avatar**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ contentType: 'image/png', body: png });
    avatarUploads++;
    profile = { ...profile, avatarUrl: '/api/me/avatar?v=saved-avatar' };
    return route.fulfill({ json: { profile } });
  });
  await page.locator('[data-nav="user"]').click();
  await page.locator('[data-user-create]').click();
  await expect(page.locator('#user-playlist-name')).toBeFocused();
  await page.locator('#user-playlist-name').fill('新声音档案');
  await page.locator('[data-user-create-form] button[type="submit"]').click();
  await expect(page.locator('[data-user-dialog]')).not.toBeVisible();
  await page.locator('[data-user-list="1"]').click();
  const rename = page.locator('[aria-label="歌单名称"]');
  await page.locator('[data-user-rename="1"]').click();
  await expect(rename).toBeFocused();
  await rename.fill('取消的名字');
  await rename.press('Escape');
  await expect(page.locator('[data-user-rename="1"]')).toBeFocused();
  expect(writes).toEqual(['POST']);
  await page.locator('[data-user-rename="1"]').click();
  await rename.fill('保存的名字');
  await rename.press('Enter');
  await expect(page.locator('[data-user-rename="1"]')).toHaveText('保存的名字');
  await expect(page.locator('[data-user-feedback]')).toContainText('歌单名称已保存');
  await page.locator('[data-user-delete="1"]').click();
  await expect(page.locator('[data-user-delete-dialog]')).toContainText('不会删除音乐文件');
  await page.locator('[data-user-delete-dialog] button[data-user-delete-cancel]').last().click();
  await expect(page.locator('[data-user-delete="1"]')).toBeVisible();
  await page.locator('[data-user-delete="1"]').click();
  await page.locator('[data-user-delete-confirm]').click();
  await expect(page.locator('[data-user-list]')).toHaveCount(0);
  await expect(page.locator('[data-user-create]')).toBeVisible();
  expect(writes).toEqual(['POST', 'PATCH', 'DELETE']);
  await page
    .locator('[data-user-avatar-file]')
    .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('[data-user-avatar-feedback]')).toContainText('JPG、PNG 或 WebP');
  expect(avatarUploads).toBe(0);
  await page
    .locator('[data-user-avatar-file]')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-user-avatar-feedback]')).toContainText('头像已保存');
  await expect(page.locator('[data-user-avatar-image]')).toHaveAttribute(
    'src',
    '/api/me/avatar?v=saved-avatar',
  );
  expect(avatarUploads).toBe(1);
  expect(errors).toEqual([]);
});

test('工作区快捷键通过输入ref打开搜索，关闭结果恢复焦点，业务弹窗Escape不误切页', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockWorkspace(page);
  const archive = page.locator('[data-album-archive]');
  await expect(archive).toHaveAttribute('data-entry-phase', 'ready', { timeout: 45000 });
  await page.keyboard.press('/');
  const input = page.getByRole('searchbox', { name: '搜索音乐' });
  await expect(input).toBeFocused();
  await input.fill('迁移');
  await input.press('Enter');
  const panel = page.locator('[data-song-search-panel]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-search-close]').click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-nav="search"]')).toBeFocused();
  await page.keyboard.press('/');
  await expect(input).toBeFocused();
  await input.fill('迁移');
  await input.press('Enter');
  await expect(panel).toBeVisible();
  await input.click();
  await expect(panel).toBeVisible();
  await input.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-nav="search"]')).toBeFocused();
  await expect(archive).toHaveAttribute('data-view', 'archive');

  await page.keyboard.press('/');
  await input.fill('迁移');
  await input.press('Enter');
  await expect(panel.locator('[data-queue-play]').first()).toBeVisible();
  await panel.locator('[data-queue-play]').first().press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-nav="search"]')).toBeFocused();

  await page.keyboard.press('/');
  await input.fill('迁移');
  await input.press('Enter');
  await expect(panel).toBeVisible();
  await page.locator('[data-nav="user"]').click();
  await expect(panel).toHaveCount(0);
  await expect(archive).toHaveAttribute('data-view', 'user');
  await page.locator('[data-user-create]').click();
  await expect(page.locator('#user-playlist-name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-user-dialog]')).not.toBeVisible();
  await expect(archive).toHaveAttribute('data-view', 'user');
  await page.keyboard.press('Escape');
  await expect(archive).toHaveAttribute('data-view', 'archive');
  expect(await page.evaluate(() => window.__migrationAudios.length)).toBe(1);
  expect(errors).toEqual([]);
});
