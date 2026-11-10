const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');

it('集中路由表只允许已实现的业务页面作为登录返回地址', async () => {
  const { workspacePaths, workspacePage, loginDestination } =
    await import('../frontend/src/app/routes.ts');
  for (const [page, url] of Object.entries(workspacePaths)) {
    assert.equal(workspacePage(url), page);
    assert.equal(loginDestination(url), url);
  }
  assert.equal(loginDestination('/admin/applications'), '/admin/applications');
  for (const value of [
    null,
    'https://evil.test',
    '//evil.test',
    '/login',
    '/user/playlist/1',
    '/upload?next=https://evil.test',
    '/%2f%2fevil.test',
  ]) {
    assert.equal(loginDestination(value), '/library');
  }
});

it('直接访问受控页面先验证身份，未登录转到保留目标的登录页', async () => {
  for (const path of ['/library', '/upload', '/user', '/footprint', '/admin/applications']) {
    await withReactHarness(async (h) => {
      h.window.history.replaceState(null, '', path);
      const { App } = await import('../frontend/src/app/App.tsx');
      let release;
      await h.render(
        h.React.createElement(App, {
          api: {
            restore: () =>
              new Promise((resolve) => {
                release = resolve;
              }),
            login: async () => ({}),
            logout: async () => {},
          },
        }),
      );
      assert.match(h.document.body.textContent, /正在验证登录会话/);
      assert.equal(h.query('[data-login-form]'), null);
      assert.equal(h.query('[data-album-archive]'), null);
      await h.React.act(async () => release(null));
      await h.flush();
      assert.equal(h.window.location.pathname, '/login');
      assert.equal(new URLSearchParams(h.window.location.search).get('next'), path);
      assert.ok(h.query('[data-login-form]'));
      assert.equal(h.query('[data-entry-start]'), null);
    });
  }
});

it('未知地址显示不存在页面，返回有效地址后仍能正常开始认证', async () => {
  await withReactHarness(async (h) => {
    h.window.history.replaceState(null, '', '/not-built-yet');
    const { App } = await import('../frontend/src/app/App.tsx');
    let restores = 0;
    await h.render(
      h.React.createElement(App, {
        api: {
          restore: async () => {
            restores++;
            return null;
          },
          login: async () => ({}),
          logout: async () => {},
        },
      }),
    );
    assert.match(h.document.body.textContent, /页面不存在/);
    assert.equal(restores, 0);
    await h.React.act(async () => h.require('a[href="/library"]').click());
    await h.flush();
    assert.equal(restores, 1);
    assert.equal(h.window.location.pathname, '/login');
    assert.equal(new URLSearchParams(h.window.location.search).get('next'), '/library');
    assert.ok(h.query('[data-login-form]'));
  });
});

it('已恢复的普通成员不能打开管理员审核页，也不显示播放器', async () => {
  await withReactHarness(async (h) => {
    h.window.history.replaceState(null, '', '/admin/applications');
    const { App } = await import('../frontend/src/app/App.tsx');
    await h.render(
      h.React.createElement(App, {
        api: {
          restore: async () => ({ id: 1, email: 'isolated@example.test', role: 'user' }),
          login: async () => ({}),
          logout: async () => {},
        },
      }),
    );
    assert.match(h.document.body.textContent, /无权访问申请审核/);
    assert.equal(h.query('[data-admin-applications]'), null);
    assert.equal(h.query('[data-album-archive]'), null);
  });
});

it('后退离开待恢复入口后，迟到 Session 响应不能覆盖新的历史位置', async () => {
  for (const user of [null, { id: 1, email: 'isolated@example.test', role: 'user' }]) {
    await withReactHarness(async (h) => {
      h.window.history.replaceState(null, '', '/future-feature');
      const { App } = await import('../frontend/src/app/App.tsx');
      const pending = [];
      await h.render(
        h.React.createElement(App, {
          api: {
            restore: () => new Promise((resolve) => pending.push(resolve)),
            login: async () => ({}),
            logout: async () => {},
          },
        }),
      );
      await h.React.act(async () => h.require('a[href="/library"]').click());
      await h.flush();
      assert.equal(pending.length, 1);
      await h.React.act(async () => {
        h.window.history.back();
        await new Promise((resolve) =>
          h.window.addEventListener('popstate', resolve, { once: true }),
        );
      });
      await h.flush();
      assert.equal(h.window.location.pathname, '/future-feature');
      await h.React.act(async () => pending[0](user));
      await h.flush();
      assert.equal(h.window.location.pathname, '/future-feature');
      assert.match(h.document.body.textContent, /页面不存在/);
      await h.React.act(async () => h.require('a[href="/library"]').click());
      await h.flush();
      assert.equal(pending.length, 2, '重新打开有效入口应重新验证，不能停在恢复状态');
      await h.React.act(async () => pending[1](null));
      await h.flush();
      assert.equal(h.window.location.pathname, '/login');
    });
  }
});

it('退出状态后用浏览器历史打开受控页面，地址同步回登录并保留新的目标', async () => {
  await withReactHarness(async (h) => {
    h.window.history.replaceState(null, '', '/upload');
    const { App } = await import('../frontend/src/app/App.tsx');
    await h.render(
      h.React.createElement(App, {
        api: { restore: async () => null, login: async () => ({}), logout: async () => {} },
      }),
    );
    assert.equal(h.window.location.pathname, '/login');
    await h.React.act(async () => {
      h.window.history.pushState({ key: 'previous-user-page' }, '', '/user');
      h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    });
    await h.flush();
    assert.equal(h.window.location.pathname, '/login');
    assert.equal(new URLSearchParams(h.window.location.search).get('next'), '/user');
    assert.ok(h.query('[data-login-form]'));
    assert.equal(h.query('[data-album-archive]'), null);
  });
});

it('认证成功等待授权时切换历史位置，会重置登录表单且旧计时器不能提升身份', async () => {
  await withReactHarness(async (h) => {
    h.window.history.replaceState(null, '', '/login?next=%2Fupload');
    const { App } = await import('../frontend/src/app/App.tsx');
    const nativeSet = globalThis.setTimeout,
      nativeClear = globalThis.clearTimeout;
    const timers = new Map();
    let id = 0,
      logins = 0;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay !== 1150) return nativeSet(callback, delay, ...args);
      const handle = { id: ++id };
      timers.set(handle, callback);
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      if (!timers.delete(handle)) nativeClear(handle);
    };
    try {
      await h.render(
        h.React.createElement(App, {
          api: {
            restore: async () => null,
            login: async () => {
              logins++;
              return { user: { id: 1, email: 'isolated@example.test', role: 'user' } };
            },
            logout: async () => {},
          },
        }),
      );
      const submit = async () => {
        await h.input('[name="email"]', 'isolated@example.test');
        await h.input('[name="password"]', 'Isolated-test1!');
        await h.submit('[data-login-form]');
      };
      await submit();
      assert.equal(timers.size, 1);
      assert.equal(h.require('[data-login-form] [type="submit"]').disabled, true);
      const late = [...timers.values()][0];
      await h.React.act(async () => {
        h.window.history.pushState({ key: 'history-user' }, '', '/user');
        h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
      });
      await h.flush();
      assert.equal(h.window.location.pathname, '/login');
      assert.equal(new URLSearchParams(h.window.location.search).get('next'), '/user');
      assert.equal(timers.size, 0, '位置变化取消旧授权延迟');
      assert.equal(
        h.require('[data-login-form] [type="submit"]').disabled,
        false,
        '新登录表单不能继承旧 busy 状态',
      );
      await h.React.act(async () => late());
      await h.flush();
      assert.equal(h.query('[data-authorized-stage]'), null);
      await submit();
      assert.equal(logins, 2, '切换历史位置后可以重新提交认证');
      assert.equal(timers.size, 1);
      await h.unmount();
      assert.equal(timers.size, 0);
    } finally {
      globalThis.setTimeout = nativeSet;
      globalThis.clearTimeout = nativeClear;
    }
  });
});
