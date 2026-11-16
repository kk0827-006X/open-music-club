const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');
const { validateConfig } = require('../src/services/avatarStudio.service');
const load = () => import('../frontend/src/features/avatar/model.ts');
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
function mockClient(model, overrides = {}) {
  return {
    read: async () => ({ viewerId: 1, context: 'session-A', outfits: [] }),
    save: async (context, name, config) => ({
      outfit: { id: 1, name, config, current: false, createdAt: '', updatedAt: '' },
    }),
    rename: async () => ({}),
    remove: async () => {},
    select: async () => ({}),
    ...overrides,
  };
}

it('所有像素部件和预设可用，自动搭配遵守锁定与配色，渲染不污染原配置', async () => {
  const { defaultConfig, catalog, slots, avatarPixels, randomOutfit } = await load();
  const original = { ...defaultConfig };
  for (const slot of slots)
    for (const part of catalog.parts[slot]) {
      const config = { ...defaultConfig, [slot]: part.id };
      assert.ok(validateConfig(config));
      assert.ok(avatarPixels(config).length > 10);
    }
  for (const preset of [...catalog.presets.map((item) => item.id), 'random']) {
    const next = randomOutfit(defaultConfig, preset, ['top', 'body'], true, () => 0.75);
    assert.equal(next.top, defaultConfig.top);
    assert.equal(next.body, defaultConfig.body);
    assert.equal(next.theme, defaultConfig.theme);
    assert.ok(catalog.hair.some((item) => item.id === next.hair));
    assert.ok(validateConfig(next));
    assert.ok(validateConfig(randomOutfit(defaultConfig, preset, [], false, () => 0.4)));
  }
  assert.deepEqual(defaultConfig, original);
});

it('工坊客户端逐次取 CSRF，携带会话上下文，错误不暴露服务端内部信息', async () => {
  const { createAvatarClient } = await import('../frontend/src/services/avatar-studio.ts');
  const { defaultConfig } = await load();
  const calls = [];
  const client = createAvatarClient(async (url, init) => {
    calls.push({ url, init });
    return response(url.includes('csrf-token') ? { csrfToken: 'fresh-token' } : { outfit: {} });
  });
  const signal = new AbortController().signal;
  await client.save('owner-session', '我的', defaultConfig, signal);
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'fresh-token');
  assert.equal(JSON.parse(calls[1].init.body).context, 'owner-session');
  assert.equal(calls[1].init.credentials, 'same-origin');
  await client.remove('owner-session', 1, signal);
  assert.equal(calls.filter((item) => item.url.includes('csrf-token')).length, 2);
  const failed = createAvatarClient(async () =>
    response({ message: '/private/internal SECRET=value' }, 500),
  );
  await assert.rejects(
    failed.read(signal),
    (error) => error.status === 500 && !/private|SECRET/.test(error.message),
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.read(aborted.signal), { name: 'AbortError' });
  await assert.rejects(
    createAvatarClient(async () => response({ success: true })).read(signal),
    /服务器响应异常/,
  );
});

it('手动换装与形象保存使用受控数据，用户名称不会作为 HTML 执行', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    let saved;
    const client = mockClient(model, {
      save: async (context, name, config) => {
        saved = { context, name, config };
        return { outfit: { id: 4, name, config, current: false, createdAt: '', updatedAt: '' } };
      },
    });
    await h.render(h.React.createElement(AvatarStudio, { active: true, client }));
    await h.click('[data-avatar-part="top-shirt"]');
    await h.click('.avatar-save-open');
    await h.input('[aria-label="形象名称"]', '<img src=x onerror=alert(1)>');
    await h.submit('.avatar-save');
    assert.equal(saved.context, 'session-A');
    assert.equal(saved.config.top, 'top-shirt');
    await h.click('[data-avatar-tab="saved"]');
    assert.match(h.require('.saved-grid').textContent, /<img src=x/);
    assert.equal(h.query('.saved-grid img'), null);
    assert.equal(h.query('audio'), null);
  });
});

it('登录失效会清除旧形象；重新验证身份后只显示新账号数据，离页取消读取', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    const { AvatarError } = await import('../frontend/src/services/avatar-studio.ts');
    let next = {
      viewerId: 1,
      context: 'A',
      outfits: [
        {
          id: 1,
          name: 'A的私有形象',
          config: model.defaultConfig,
          current: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    let expired = false,
      signal;
    const client = mockClient(model, {
      read: async (value) => {
        signal = value;
        if (expired) throw new AvatarError('登录已失效', 401);
        return next;
      },
    });
    await h.render(h.React.createElement(AvatarStudio, { active: true, client }));
    await h.click('[data-avatar-tab="saved"]');
    assert.match(h.document.body.textContent, /A的私有形象/);
    expired = true;
    h.window.dispatchEvent(new h.window.Event('focus'));
    await h.wait();
    assert.doesNotMatch(h.document.body.textContent, /A的私有形象/);
    assert.equal(h.query('.saved-grid'), null);
    expired = false;
    next = { viewerId: 2, context: 'B', outfits: [] };
    await h.click('.avatar-studio > button');
    await h.click('[data-avatar-tab="saved"]');
    assert.match(h.document.body.textContent, /还没有保存的形象/);
    await h.render(h.React.createElement(AvatarStudio, { active: false, client }));
    assert.equal(signal.aborted, true);
    assert.equal(h.query('[data-avatar-studio]'), null);
  });
});

it('旧会话写入返回 409 时清除草稿和形象，绝不继续用新会话静默重试', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    const { AvatarError } = await import('../frontend/src/services/avatar-studio.ts');
    let writes = 0;
    const client = mockClient(model, {
      save: async () => {
        writes++;
        throw new AvatarError('工坊会话已变化', 409);
      },
    });
    await h.render(h.React.createElement(AvatarStudio, { active: true, client }));
    await h.click('.avatar-save-open');
    await h.input('[aria-label="形象名称"]', '旧账号草稿');
    await h.submit('.avatar-save');
    assert.equal(writes, 1);
    assert.equal(h.query('.avatar-save'), null);
    assert.doesNotMatch(h.document.body.textContent, /旧账号草稿/);
    assert.match(h.require('[data-avatar-status]').textContent, /会话已变化/);
  });
});

it('切换身份后的迟到保存响应不更新新形象库', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    let resolve,
      pendingSignal,
      reads = 0;
    const client = mockClient(model, {
      read: async () => ({ viewerId: ++reads, context: `session-${reads}`, outfits: [] }),
      save: async (context, name, config, signal) => {
        pendingSignal = signal;
        return new Promise((done) => {
          resolve = () => done({ outfit: { id: 6, name, config } });
        });
      },
    });
    await h.render(h.React.createElement(AvatarStudio, { active: true, client }));
    await h.click('.avatar-save-open');
    await h.input('[aria-label="形象名称"]', 'A的迟到结果');
    await h.submit('.avatar-save');
    h.window.dispatchEvent(new h.window.Event('focus'));
    await h.wait();
    assert.equal(pendingSignal.aborted, true);
    resolve();
    await h.wait();
    await h.click('[data-avatar-tab="saved"]');
    assert.doesNotMatch(h.document.body.textContent, /A的迟到结果/);
  });
});

it('原版保存弹窗失败时保留草稿，取消向宿主报告；删除使用两次点击确认', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    const { AvatarError } = await import('../frontend/src/services/avatar-studio.ts');
    const events = [];
    let removed = 0;
    const outfit = {
      id: 1,
      name: '旧名称',
      config: model.defaultConfig,
      current: false,
      createdAt: '',
      updatedAt: '',
    };
    const client = mockClient(model, {
      read: async () => ({ viewerId: 1, context: 'A', outfits: [outfit] }),
      save: async () => {
        throw new AvatarError('保存失败', 500);
      },
      remove: async () => {
        removed++;
      },
    });
    await h.render(
      h.React.createElement(AvatarStudio, {
        active: true,
        client,
        onDialogChange: (open) => events.push(open),
      }),
    );
    await h.click('.avatar-save-open');
    await h.input('[aria-label="形象名称"]', '保留的草稿');
    await h.submit('.avatar-save');
    assert.equal(h.require('.avatar-source-dialog').open, true);
    assert.equal(h.require('[aria-label="形象名称"]').value, '保留的草稿');
    assert.ok(events.includes(true));
    await h.click('.avatar-source-dialog button[type="button"]');
    assert.equal(events.at(-1), false);
    await h.click('[data-avatar-tab="saved"]');
    await h.click('.saved-actions button:last-child');
    assert.equal(removed, 0);
    assert.equal(h.require('.saved-actions button:last-child').textContent, '确认删除');
    await h.click('.saved-actions button:last-child');
    assert.equal(removed, 1);
    assert.equal(h.query('[data-avatar-outfit]'), null);
  });
});

it('zyr 原版八套渐变色板、四套肤色、六组选择与清除行为；原版没有独立发色选择器', async () => {
  await withReactHarness(async (h) => {
    const model = await load();
    const { AvatarStudio } = await import('../frontend/src/features/avatar/AvatarStudio.tsx');
    let saved;
    const client = mockClient(model, {
      save: async (context, name, config) => {
        saved = config;
        return { outfit: { id: 2, name, config, current: false, createdAt: '', updatedAt: '' } };
      },
    });
    await h.render(h.React.createElement(AvatarStudio, { active: true, client }));
    assert.equal(h.document.querySelectorAll('.palette-chip').length, 8);
    assert.equal(h.document.querySelectorAll('.skin-chip').length, 4);
    assert.equal(h.document.querySelectorAll('.slot-card').length, 6);
    assert.equal(h.document.querySelectorAll('[data-avatar-part]').length, 59);
    assert.equal(h.query('[aria-label="发色"]'), null);
    await h.click('[aria-label="灰粉主题色"]');
    assert.equal(h.require('[aria-label="灰粉主题色"]').getAttribute('aria-checked'), 'true');
    assert.match(h.require('[aria-label="灰粉主题色"]').style.background, /linear-gradient/);
    await h.click('[data-clear-slot="head"]');
    await h.click('.avatar-save-open');
    await h.submit('.avatar-save');
    assert.equal(saved.head, null);
    assert.equal(saved.theme, 'rose');
    await h.click('[data-avatar-tab="auto"]');
    await h.click('[data-lock="head"]');
    assert.equal(h.require('[data-lock="head"]').getAttribute('aria-pressed'), 'true');
  });
});

it('原版保持配色只锁主题，头部锁定保护肤色发色；预设配饰允许留空', async () => {
  const { defaultConfig, randomOutfit } = await load();
  const kept = randomOutfit(defaultConfig, 'street', ['head'], false, () => 0.8);
  assert.equal(kept.head, defaultConfig.head);
  assert.equal(kept.hair, defaultConfig.hair);
  assert.equal(kept.skin, defaultConfig.skin);
  const changed = randomOutfit(defaultConfig, 'street', [], true, () => 0.8);
  assert.equal(changed.theme, defaultConfig.theme);
  assert.notEqual(changed.hair, defaultConfig.hair);
  assert.notEqual(changed.skin, defaultConfig.skin);
  const cleared = randomOutfit(defaultConfig, 'street', [], true, () => 0);
  assert.equal(cleared.accessory, null);
  assert.ok(validateConfig(cleared));
  const random = randomOutfit(defaultConfig, 'random', ['head'], true, () => 0.8);
  assert.equal(random.head, defaultConfig.head);
  assert.notEqual(random.hair, defaultConfig.hair);
});
