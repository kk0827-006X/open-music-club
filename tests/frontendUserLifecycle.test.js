const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');

const profile = { id: 1, nickname: '隔离成员', avatarUrl: null };
const list = { id: 1, name: '原歌单', trackCount: 1, coverUrl: null };
const track = (id) => ({
  source: 'local',
  sourceId: String(id),
  trackKey: `local:${id}`,
  title: `歌曲${id}`,
  artists: [],
  album: { name: null },
  durationMs: 1000,
  playable: true,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const client = (overrides = {}) => ({
  profile: async () => profile,
  playlists: async () => [list],
  playlist: async () => ({ playlist: list, tracks: [track(1)] }),
  likes: async () => [],
  uploads: async () => [],
  ...overrides,
});
async function mount(h, api, strict = false) {
  const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx');
  const ref = h.React.createRef();
  const node = h.React.createElement(UserPage, { active: true, client: api, ref });
  await h.render(strict ? h.React.createElement(h.React.StrictMode, null, node) : node);
  return ref;
}
async function avatar(h, type = 'image/png', size = 1) {
  const input = h.require('[data-user-avatar-file]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([new Uint8Array(size)], 'avatar.png', { type })],
  });
  await h.React.act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await h.flush();
}

it('头像保存后，较早的资料刷新不能覆盖新头像和昵称', async () => {
  await withReactHarness(async (h) => {
    const old = deferred();
    let calls = 0;
    const ref = await mount(
      h,
      client({
        profile: () => (++calls === 1 ? Promise.resolve(profile) : old.promise),
        uploadAvatar: async () => ({
          ...profile,
          nickname: '新昵称',
          avatarUrl: '/api/me/avatar?v=new-avatar',
        }),
      }),
    );
    let refreshing;
    await h.React.act(async () => {
      refreshing = ref.current.refresh();
    });
    await avatar(h);
    await h.React.act(async () => {
      old.resolve(profile);
      await refreshing;
    });
    assert.equal(h.require('[data-user-nickname]').textContent, '新昵称');
    assert.equal(
      h.require('[data-user-avatar-image]').getAttribute('src'),
      '/api/me/avatar?v=new-avatar',
    );
    assert.match(h.require('[data-user-avatar-feedback]').textContent, /头像已保存/);
  });
});

it('头像非法文件不上传，同一上传在途时不重复提交', async () => {
  await withReactHarness(async (h) => {
    const saved = deferred();
    let calls = 0;
    await mount(
      h,
      client({
        uploadAvatar: () => {
          calls++;
          return saved.promise;
        },
      }),
    );
    await avatar(h, 'image/svg+xml');
    assert.equal(calls, 0);
    assert.match(h.require('[data-user-avatar-feedback]').textContent, /JPG、PNG 或 WebP/);
    await avatar(h);
    await avatar(h);
    assert.equal(calls, 1);
    await h.React.act(async () => saved.resolve(profile));
  });
});

it('会话失效清除旧歌单、昵称与头像，刷新报告失败', async () => {
  await withReactHarness(async (h) => {
    const { PersonalLibraryError } =
      await import('../frontend/src/services/music/personal-library.ts');
    let expired = false;
    const ref = await mount(
      h,
      client({
        profile: async () => {
          if (expired) throw new PersonalLibraryError('登录已失效', 401);
          return { ...profile, avatarUrl: '/api/me/avatar?v=old' };
        },
      }),
    );
    expired = true;
    let success;
    await h.React.act(async () => {
      success = await ref.current.refresh();
    });
    assert.equal(success, false);
    assert.equal(h.query('[data-user-list="1"]'), null);
    assert.equal(h.require('[data-user-nickname]').textContent, '会话已失效');
    assert.equal(h.require('[data-user-avatar-image]').hasAttribute('src'), false);
  });
});

it('取消喜爱末页最后一首后回退上一页，不停留在空页', async () => {
  await withReactHarness(async (h) => {
    let removed = false;
    const offsets = [];
    await mount(
      h,
      client({
        likes: async (offset) => {
          offsets.push(offset);
          return offset === 0
            ? Array.from({ length: removed ? 5 : 6 }, (_, i) => track(i + 1))
            : removed
              ? []
              : [track(6)];
        },
        setLiked: async (_track, liked) => {
          assert.equal(liked, false);
          removed = true;
        },
      }),
    );
    await h.click('[data-user-tab="favorites"]');
    await h.click('[data-user-page-step="1"]');
    await h.click('[data-user-like="local:6"]');
    assert.match(h.require('.user-pagination').textContent, /第 1 页/);
    assert.equal(h.require('[data-user-page-step="-1"]').disabled, true);
    assert.equal(h.require('[data-user-page-step="1"]').disabled, true);
    assert.deepEqual(offsets, [0, 5, 5, 0]);
  });
});

it('重命名 Escape 取消并归还焦点，迟到 blur 不保存；下一轮提交只保存一次', async () => {
  await withReactHarness(async (h) => {
    const calls = [];
    const pending = deferred();
    await mount(
      h,
      client({
        renamePlaylist: (id, name) => {
          calls.push([id, name]);
          return pending.promise;
        },
      }),
    );
    await h.click('[data-user-list="1"]');
    await h.click('[data-user-rename="1"]');
    await h.input('[aria-label="歌单名称"]', '取消的名字');
    await h.React.act(async () =>
      h
        .require('[aria-label="歌单名称"]')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    );
    await h.flush();
    assert.equal(h.document.activeElement, h.require('[data-user-rename="1"]'));
    assert.deepEqual(calls, []);
    await h.click('[data-user-rename="1"]');
    await h.input('[aria-label="歌单名称"]', '新名字');
    await h.submit('[data-user-rename-form]');
    await h.submit('[data-user-rename-form]');
    assert.deepEqual(calls, [[1, '新名字']]);
    await h.React.act(async () => pending.resolve());
  });
});

it('创建失败保留草稿和错误，重试成功后回到歌单列表并关闭弹窗', async () => {
  await withReactHarness(async (h) => {
    let fail = true;
    const calls = [];
    const ref = await mount(
      h,
      client({
        createPlaylist: async (name) => {
          calls.push(name);
          if (fail) throw new Error('隔离创建失败');
        },
      }),
    );
    await h.click('[data-user-create]');
    assert.equal(h.document.activeElement, h.require('#user-playlist-name'));
    await h.input('#user-playlist-name', ' 新歌单 ');
    await h.submit('[data-user-create-form]');
    assert.equal(ref.current.hasOpenDialog, true);
    assert.match(h.require('[data-user-dialog-feedback]').textContent, /隔离创建失败/);
    assert.equal(h.require('#user-playlist-name').value, ' 新歌单 ');
    fail = false;
    await h.submit('[data-user-create-form]');
    assert.equal(ref.current.hasOpenDialog, false);
    assert.deepEqual(calls, ['新歌单', '新歌单']);
    assert.match(h.require('[data-user-feedback]').textContent, /歌单已保存/);
  });
});

it('删除在途不能关闭或重复提交，成功后退出详情并刷新列表', async () => {
  await withReactHarness(async (h) => {
    const pending = deferred();
    let deleted = false;
    let calls = 0;
    const ref = await mount(
      h,
      client({
        playlists: async () => (deleted ? [] : [list]),
        deletePlaylist: async () => {
          calls++;
          await pending.promise;
          deleted = true;
        },
      }),
    );
    await h.click('[data-user-list="1"]');
    await h.click('[data-user-delete="1"]');
    await h.click('[data-user-delete-confirm]');
    assert.equal(h.require('[data-user-delete-cancel]').disabled, true);
    assert.equal(h.require('[data-user-delete-confirm]').disabled, true);
    await h.React.act(async () =>
      h
        .require('[data-user-delete-dialog]')
        .dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    assert.equal(ref.current.hasOpenDialog, true);
    assert.equal(calls, 1);
    await h.React.act(async () => pending.resolve());
    await h.flush();
    assert.equal(ref.current.hasOpenDialog, false);
    assert.equal(h.query('[data-user-back]'), null);
    assert.equal(h.query('[data-user-list="1"]'), null);
    assert.match(h.require('[data-user-feedback]').textContent, /歌单已删除/);
  });
});

it('StrictMode 重挂载后旧刷新不能覆盖最新列表', async () => {
  await withReactHarness(async (h) => {
    const old = deferred();
    let profiles = 0;
    let lists = 0;
    await mount(
      h,
      client({
        profile: () => (++profiles === 1 ? old.promise : Promise.resolve(profile)),
        playlists: async () => {
          lists++;
          return [list];
        },
      }),
      true,
    );
    assert.equal(lists, 1);
    await h.React.act(async () => old.resolve({ ...profile, nickname: '过期资料' }));
    assert.equal(lists, 1);
    assert.equal(h.require('[data-user-nickname]').textContent, profile.nickname);
    await h.unmount();
  });
});

it('刷新在途卸载后，迟到的资料响应不能再发出歌单读取', async () => {
  await withReactHarness(async (h) => {
    let calls = 0;
    let reads = 0;
    const pending = deferred();
    const ref = await mount(
      h,
      client({
        profile: () => (++calls === 1 ? Promise.resolve(profile) : pending.promise),
        playlists: async () => {
          reads++;
          return [list];
        },
      }),
    );
    let refreshing;
    await h.React.act(async () => {
      refreshing = ref.current.refresh();
    });
    await h.unmount();
    pending.resolve(profile);
    assert.equal(await refreshing, false);
    assert.equal(reads, 1);
  });
});

it('删除失败保留确认框和当前歌单，成功重试后退出详情', async () => {
  await withReactHarness(async (h) => {
    let fail = true;
    let deleted = false;
    const ref = await mount(
      h,
      client({
        playlists: async () => (deleted ? [] : [list]),
        deletePlaylist: async () => {
          if (fail) throw new Error('隔离删除失败');
          deleted = true;
        },
      }),
    );
    await h.click('[data-user-list="1"]');
    await h.click('[data-user-delete="1"]');
    await h.click('[data-user-delete-confirm]');
    assert.equal(ref.current.hasOpenDialog, true);
    assert.match(h.require('[data-user-delete-feedback]').textContent, /隔离删除失败/);
    assert.ok(h.require('[data-user-back]'));
    fail = false;
    await h.click('[data-user-delete-confirm]');
    assert.equal(ref.current.hasOpenDialog, false);
    assert.equal(h.query('[data-user-back]'), null);
  });
});
