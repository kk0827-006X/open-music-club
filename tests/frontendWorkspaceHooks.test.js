const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');

it('工作区本地导航保留已访问页面，重复切页会关闭搜索并重置详情', async () => {
  await withReactHarness(async (h) => {
    const { useWorkspaceNavigation } =
      await import('../frontend/src/app/hooks/use-workspace-navigation.ts');
    let navigation;
    let resets = 0;
    const library = { current: { resetDetail: () => resets++ } };
    function Probe(props) {
      navigation = useWorkspaceNavigation({ library, ...props });
      return null;
    }
    await h.render(h.React.createElement(Probe));
    assert.equal(navigation.page, 'archive');
    assert.deepEqual([...navigation.visited], []);
    await h.React.act(async () => navigation.setSongQuery({ term: '搜索', serial: 1 }));
    await h.React.act(async () => navigation.show('user'));
    assert.equal(navigation.page, 'user');
    assert.equal(navigation.songQuery, null);
    await h.React.act(async () => navigation.show('upload'));
    await h.React.act(async () => navigation.show('archive'));
    assert.deepEqual([...navigation.visited], ['user', 'upload']);
    assert.ok(resets >= 2);
  });
});

it('受控导航等待外部路由更新，历史切页也登记访问且关闭搜索，不丢弃已访问页面', async () => {
  await withReactHarness(async (h) => {
    const { useWorkspaceNavigation } =
      await import('../frontend/src/app/hooks/use-workspace-navigation.ts');
    let navigation;
    const navigations = [];
    const library = { current: { resetDetail() {} } };
    function Probe({ page }) {
      navigation = useWorkspaceNavigation({
        library,
        routedPage: page,
        onNavigate: (next) => navigations.push(next),
      });
      return null;
    }
    await h.render(h.React.createElement(Probe, { page: 'upload' }));
    await h.React.act(async () => navigation.show('user'));
    assert.deepEqual(navigations, ['user']);
    assert.equal(navigation.page, 'upload');
    await h.React.act(async () => navigation.setSongQuery({ term: '历史前的搜索', serial: 1 }));
    await h.render(h.React.createElement(Probe, { page: 'footprint' }));
    assert.equal(navigation.songQuery, null);
    assert.equal(navigation.page, 'footprint');
    assert.deepEqual([...navigation.visited], ['upload', 'user', 'footprint']);
    await h.render(h.React.createElement(Probe, { page: 'user' }));
    assert.deepEqual([...navigation.visited], ['upload', 'user', 'footprint']);
  });
});

it('档案键盘保留加载、设置、展开播放器、详情和输入区域的优先级，并在卸载时清理监听', async () => {
  await withReactHarness(async (h) => {
    const { useArchiveKeyboard } =
      await import('../frontend/src/app/hooks/use-archive-keyboard.ts');
    const calls = [];
    const scene = { entryPhase: 'ready' };
    const playerView = {
      current: { expanded: false, setExpanded: (...args) => calls.push(['expanded', ...args]) },
    };
    const settings = { current: { open: false } };
    const library = {
      current: {
        mode: 'archive',
        navigate: (...args) => calls.push(['navigate', ...args]),
        openDetail: () => calls.push(['open']),
        closeDetail: () => calls.push(['close']),
      },
    };
    const user = { current: { hasOpenDialog: false } };
    const footprint = { current: { hasOpenDialog: false } };
    const archive = { current: null };
    const inputRef = { current: null };
    const show = (page) => calls.push(['show', page]);
    function Probe({ page = 'archive' }) {
      useArchiveKeyboard({
        page,
        scene,
        playerView,
        library,
        settings,
        user,
        footprint,
        archive,
        inputRef,
        show,
      });
      return h.React.createElement(
        'main',
        {
          ref: (node) => {
            archive.current = node;
          },
        },
        h.React.createElement('input', {
          ref: (node) => {
            inputRef.current = node;
          },
        }),
        h.React.createElement(
          'button',
          { 'data-nav': 'search', onClick: () => calls.push(['search']) },
          '搜索',
        ),
      );
    }
    const render = (page = 'archive') =>
      h.render(
        h.React.createElement(h.React.StrictMode, null, h.React.createElement(Probe, { page })),
      );
    const key = async (value, target = h.window, prevented = false) => {
      const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
      if (prevented) event.preventDefault();
      await h.React.act(async () => target.dispatchEvent(event));
      return event;
    };
    await render();
    await key('ArrowRight');
    await key('Enter');
    assert.deepEqual(calls.splice(0), [['navigate', 'lane', 1], ['open']]);
    await key('ArrowDown', inputRef.current);
    await key('ArrowDown', h.window, true);
    settings.current.open = true;
    await key('ArrowDown');
    settings.current.open = false;
    scene.entryPhase = 'loading';
    await key('ArrowDown');
    scene.entryPhase = 'ready';
    assert.deepEqual(calls, []);
    playerView.current.expanded = true;
    await key('ArrowLeft');
    await key('Escape');
    assert.deepEqual(calls.splice(0), [['expanded', false, true]]);
    playerView.current.expanded = false;
    library.current.mode = 'detail';
    await key('ArrowLeft');
    await key('Escape');
    assert.deepEqual(calls.splice(0), [['close']]);
    library.current.mode = 'archive';
    await key('/');
    assert.equal(h.document.activeElement, inputRef.current);
    inputRef.current.disabled = true;
    await key('/');
    assert.deepEqual(calls.splice(0), [['search']]);
    inputRef.current.disabled = false;
    scene.entryPhase = 'loading';
    await render('user');
    user.current.hasOpenDialog = true;
    await key('Escape');
    assert.deepEqual(calls, []);
    user.current.hasOpenDialog = false;
    await key('Escape');
    assert.deepEqual(calls.splice(0), [['show', 'archive']]);
    await render('footprint');
    footprint.current.hasOpenDialog = true;
    await key('Escape');
    assert.deepEqual(calls, []);
    footprint.current.hasOpenDialog = false;
    await key('Escape');
    assert.deepEqual(calls.splice(0), [['show', 'archive']]);
    await h.unmount();
    await key('Escape');
    assert.deepEqual(calls, []);
  });
});

it('GooeySearch 向外暴露真实输入 ref，关闭和卸载会清空，重新打开指向新输入', async () => {
  await withReactHarness(async (h) => {
    const { GooeySearch } = await import('../frontend/src/shared/react/aceternity/GooeySearch.tsx');
    const inputRef = h.React.createRef();
    await h.render(h.React.createElement(GooeySearch, { inputRef }));
    assert.equal(inputRef.current, null);
    await h.click('[data-nav="search"]');
    const first = inputRef.current;
    assert.equal(first, h.require('[data-music-search-input]'));
    await h.React.act(async () =>
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    await h.flush();
    assert.equal(inputRef.current, null);
    assert.equal(h.document.activeElement, h.require('[data-nav="search"]'));
    await h.click('[data-nav="search"]');
    assert.notEqual(inputRef.current, first);
    assert.equal(inputRef.current, h.require('[data-music-search-input]'));
    await h.unmount();
    assert.equal(inputRef.current, null);
  });
});
