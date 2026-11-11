const assert = require('node:assert/strict');
const { it } = require('node:test');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { withReactHarness } = require('./helpers/reactHarness');
const frontendRequire = createRequire(path.resolve(__dirname, '../frontend/package.json'));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const user = { id: 1, email: 'isolated@example.test', role: 'user' };

async function mountMachine(h, api, pathname = '/user', strict = false) {
  // 与生产 TS 模块共用 ESM Router 上下文，不能混用 require 的独立模块实例。
  const { MemoryRouter, useLocation } = await import(
    pathToFileURL(frontendRequire.resolve('react-router')).href
  );
  const { useAuthMachine } = await import('../frontend/src/app/hooks/use-auth-machine.ts');
  let machine, location;
  function Probe() {
    machine = useAuthMachine(api);
    location = useLocation();
    return null;
  }
  const node = h.React.createElement(
    MemoryRouter,
    { initialEntries: [pathname] },
    h.React.createElement(Probe),
  );
  await h.render(strict ? h.React.createElement(h.React.StrictMode, null, node) : node);
  return {
    get machine() {
      return machine;
    },
    get location() {
      return location;
    },
  };
}

it('认证状态机退出失败保留工作区，成功退出后迟到的密码认证不能提升身份', async () => {
  await withReactHarness(async (h) => {
    const login = deferred();
    let rejectLogout = true;
    const state = await mountMachine(h, {
      restore: async () => user,
      login: () => login.promise,
      logout: async () => {
        if (rejectLogout) throw new Error('隔离退出失败');
      },
    });
    assert.equal(state.machine.stage, 'workspace');
    await h.React.act(async () => {
      await assert.rejects(state.machine.logout(), /隔离退出失败/);
    });
    assert.equal(state.machine.stage, 'workspace');
    assert.equal(state.location.pathname, '/user');
    let authenticating;
    await h.React.act(async () => {
      authenticating = state.machine.authenticate({
        email: user.email,
        password: 'synthetic-only',
      });
    });
    rejectLogout = false;
    await h.React.act(async () => state.machine.logout());
    assert.equal(state.machine.stage, 'login');
    assert.equal(state.location.pathname, '/login');
    assert.equal(new URLSearchParams(state.location.search).get('next'), '/user');
    let result;
    await h.React.act(async () => {
      login.resolve({ user: { ...user, role: 'admin' } });
      result = await authenticating;
    });
    assert.deepEqual(result, {});
    assert.equal(state.machine.stage, 'login');
    assert.equal(state.machine.role, 'user');
  });
});

it('重复进入仅接受最新恢复结果，旧管理员响应不能覆盖新成员身份', async () => {
  await withReactHarness(async (h) => {
    const pending = [];
    const state = await mountMachine(
      h,
      {
        restore: () => {
          const request = deferred();
          pending.push(request);
          return request.promise;
        },
        login: async () => ({}),
        logout: async () => {},
      },
      '/',
    );
    let first, second;
    await h.React.act(async () => {
      first = state.machine.enter();
      second = state.machine.enter();
    });
    assert.equal(pending.length, 2);
    await h.React.act(async () => {
      pending[1].resolve(user);
      await second;
    });
    assert.equal(state.machine.stage, 'authorized');
    await h.React.act(async () => {
      pending[0].resolve({ ...user, role: 'admin' });
      await first;
    });
    assert.equal(state.machine.role, 'user');
    assert.equal(state.machine.stage, 'authorized');
    await h.React.act(async () => state.machine.completeAuthorization());
    assert.equal(state.machine.stage, 'workspace');
    assert.equal(state.location.pathname, '/library');
  });
});

it('认证状态机 StrictMode 清理使旧恢复失效，重挂载后按新请求身份直达目标', async () => {
  await withReactHarness(async (h) => {
    const pending = [];
    let calls = 0;
    const state = await mountMachine(
      h,
      {
        restore: () => {
          calls++;
          if (calls === 1) {
            const old = deferred();
            pending.push(old);
            return old.promise;
          }
          return Promise.resolve(user);
        },
        login: async () => ({}),
        logout: async () => {},
      },
      '/user',
      true,
    );
    assert.equal(state.machine.stage, 'workspace');
    assert.equal(state.machine.role, 'user');
    assert.equal(state.location.pathname, '/user');
    await h.React.act(async () => pending[0].resolve({ ...user, role: 'admin' }));
    assert.equal(state.machine.role, 'user');
    assert.equal(state.machine.stage, 'workspace');
  });
});
