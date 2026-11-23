const assert = require('node:assert/strict');
const { it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');
const song = (id) => ({
  id,
  name: `歌曲${id}`,
  ar: [{ name: '歌手' }],
  al: { name: '专辑' },
  dt: 60000,
});
it('所选歌曲使用自身专辑 ID，缺 ID 补查后复用专辑曲目接口', async () => {
  const { toNeteaseSearchItems } = await import('../frontend/src/services/music/search.ts');
  const { fetchSearchAlbum } = await import('../frontend/src/services/music/search-album.ts');
  const source = { ...song(11), name: '同名歌曲', al: { id: 17, name: '原版' } };
  const [entry] = toNeteaseSearchItems({ result: { songs: [source] } }, 'song');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'same-origin');
    return {
      ok: true,
      json: async () =>
        url.includes('/song/detail')
          ? { code: 200, songs: [{ ...source, al: null, album: { id: 18, name: '现场版' } }] }
          : {
              code: 200,
              album: {
                id: url.endsWith('17') ? 17 : 18,
                name: '对应专辑',
                picUrl: 'https://p1.music.126.net/album.jpg',
              },
              songs: [song(8), source, song(4)],
            },
    };
  };
  const signal = new AbortController().signal;
  const album = await fetchSearchAlbum(entry, signal, fetcher);
  assert.equal(album.title, '对应专辑');
  assert.equal(album.coverUrl, 'https://p1.music.126.net/album.jpg');
  assert.equal(album.selectedTrackId, 'netease:11');
  assert.deepEqual(
    album.tracks.map((item) => item.key),
    ['netease:8', 'netease:11', 'netease:4'],
  );
  await fetchSearchAlbum({ ...entry, albumId: undefined }, signal, fetcher);
  assert.deepEqual(calls, [
    '/api/netease/album?id=17',
    '/api/netease/song/detail?ids=11',
    '/api/netease/album?id=18',
  ]);
});

it('本地专辑按同艺人与同专辑名归组，专辑信息缺失和未返回所选歌曲时明确报错', async () => {
  const { toLocalSearchItems } = await import('../frontend/src/services/music/search.ts');
  const { fetchSearchAlbum } = await import('../frontend/src/services/music/search-album.ts');
  const local = (id, artist, album) => ({
    sourceId: String(id),
    title: `本地歌曲${id}`,
    artists: [{ name: artist }],
    album: { name: album },
  });
  const tracks = [
    local(1, '歌手甲', '专辑'),
    local(2, '歌手乙', '专辑'),
    local(3, '歌手甲', '专辑'),
  ];
  const [entry] = toLocalSearchItems(tracks);
  const signal = new AbortController().signal;
  const album = await fetchSearchAlbum(entry, signal, async (url) => {
    assert.equal(url, '/api/local/music');
    return { ok: true, json: async () => ({ success: true, tracks }) };
  });
  assert.equal(album.selectedTrackId, 'local:1');
  assert.deepEqual(
    album.tracks.map((item) => item.key),
    ['local:1', 'local:3'],
  );
  await assert.rejects(fetchSearchAlbum({ ...entry, album: '未归档' }, signal), /没有专辑信息/);
  await assert.rejects(
    fetchSearchAlbum({ ...entry, source: 'netease', albumId: '123' }, signal, async () => ({
      ok: true,
      json: async () => ({ code: 200, songs: [song(3)] }),
    })),
    /未返回所选歌曲/,
  );
});
it('统一搜索展开最匹配歌手与专辑，歌曲去重、来源分离并按页加载', async () => {
  const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
  const calls = [];
  const fetcher = async (address) => {
    calls.push(address);
    const url = new URL(address, 'http://localhost');
    let body;
    if (url.pathname === '/api/local/music')
      body = {
        success: true,
        tracks: [
          { sourceId: '1', title: '匹配', artists: [], album: { name: '本地' }, durationMs: 1 },
        ],
      };
    else if (url.pathname.endsWith('/album')) body = { code: 200, songs: [song(1), song(3)] };
    else if (url.pathname.endsWith('/artist/songs'))
      body = { code: 200, songs: [song(1), song(2)], more: false };
    else if (url.searchParams.get('type') === '100')
      body = { code: 200, result: { artists: [{ id: 10, name: '歌手' }] } };
    else if (url.searchParams.get('type') === '10')
      body = { code: 200, result: { albums: [{ id: 20, name: '专辑' }] } };
    else
      body = {
        code: 200,
        result: { songs: [song(url.searchParams.get('offset') === '0' ? 1 : 4)], songCount: 31 },
      };
    return { ok: true, status: 200, json: async () => body };
  };
  const search = createSongSearch('匹配', fetcher);
  const first = await search.next();
  assert.deepEqual(
    first.items.map((item) => item.key),
    ['netease:1', 'netease:2', 'local:1', 'netease:3'],
  );
  assert.equal(first.hasMore, true);
  assert.ok(first.items.every((item) => item.kind === 'song'));
  const second = await search.next();
  assert.deepEqual(
    second.items.map((item) => item.key),
    ['netease:4'],
  );
  assert.equal(second.hasMore, false);
  assert.equal(calls.filter((url) => url.includes('type=100')).length, 1);
});
it('搜索来源部分失败时保留其他来源，取消请求不会被当成空结果', async () => {
  const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
  const controller = new AbortController();
  const fetcher = async (url) => {
    if (url === '/api/local/music')
      return { ok: true, json: async () => ({ success: true, tracks: [] }) };
    throw Error('隔离错误');
  };
  const result = await createSongSearch('词', fetcher).next();
  assert.match(result.warning, /暂时不可用/);
  controller.abort();
  await assert.rejects(createSongSearch('词', fetcher, controller.signal).next());
});
it('搜索结果分别打开专辑、播放和加入歌单，保留队列编辑隔离', async () => {
  await withReactHarness(async (h) => {
    const { QueuePanel } = await import('../frontend/src/features/queue/QueuePanel.tsx');
    const calls = [];
    const item = {
      kind: 'song',
      key: 'netease:1',
      source: 'netease',
      sourceId: '1',
      title: '歌曲',
      artist: '歌手',
      album: '专辑',
      coverUrl: '',
      duration: '1:00',
      year: '',
      description: '',
    };
    await h.render(
      h.React.createElement(QueuePanel, {
        mode: 'search',
        open: true,
        items: [item],
        reduced: true,
        likes: new Map(),
        pendingLikes: new Set(),
        orderStatus: '',
        onClose() {},
        onFocusToggle() {},
        onClear() {
          throw Error('不得清空');
        },
        onRemove() {
          throw Error('不得删除');
        },
        onLike() {},
        onReorder() {
          throw Error('不得排序');
        },
        onPlay: (track) => calls.push(['play', track.key]),
        onOpenAlbum: (track) => calls.push(['album', track.key]),
        onSave: (track) => calls.push(['save', track.key]),
      }),
    );
    assert.equal(h.query('[data-queue-clear]'), null);
    assert.equal(h.query('[data-queue-remove]'), null);
    assert.equal(h.query('[data-queue-like]'), null);
    assert.equal(h.query('[data-queue-drag]'), null);
    await h.click('[data-queue-play]');
    await h.click('[data-queue-save]');
    await h.click('[data-search-open-album]');
    await h.React.act(async () => h.require('[data-queue-key] img').click());
    assert.deepEqual(calls, [
      ['play', 'netease:1'],
      ['save', 'netease:1'],
      ['album', 'netease:1'],
      ['album', 'netease:1'],
    ]);
  });
});

it('Gooey 仅在非中文组字的 Enter 提交非空关键词，不随输入自动请求', async () => {
  await withReactHarness(async (h) => {
    const { GooeySearch } = await import('../frontend/src/shared/react/aceternity/GooeySearch.tsx');
    const queries = [];
    await h.render(
      h.React.createElement(GooeySearch, { onSearch: (query) => queries.push(query) }),
    );
    await h.click('[data-nav="search"]');
    const enter = async (composing) =>
      h.React.act(async () =>
        h.require('input').dispatchEvent(
          new h.window.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            isComposing: composing,
          }),
        ),
      );
    await enter(false);
    assert.deepEqual(queries, []);
    await h.input('input', '  周杰伦  ');
    assert.deepEqual(queries, []);
    await enter(true);
    assert.deepEqual(queries, []);
    await enter(false);
    assert.deepEqual(queries, ['周杰伦']);
  });
});

// 所有请求都经当前生产搜索入口发出，不再直接测试已退出生产的旧搜索函数。
function coverSearchFixture({ direct = [], artist = [], album = [], local = [], detail } = {}) {
  const calls = [];
  const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
  const fetcher = async (address, options) => {
    calls.push({ address, options });
    const url = new URL(address, 'http://localhost');
    if (url.pathname === '/api/local/music') return response({ success: true, tracks: local });
    if (url.pathname.endsWith('/song/detail')) return detail(url, response);
    if (url.pathname.endsWith('/artist/songs'))
      return response({ code: 200, songs: artist, more: false });
    if (url.pathname.endsWith('/album')) return response({ code: 200, songs: album });
    const type = url.searchParams.get('type');
    if (type === '100')
      return response({
        code: 200,
        result: { artists: artist.length ? [{ id: 7, name: '歌手' }] : [] },
      });
    if (type === '10')
      return response({
        code: 200,
        result: { albums: album.length ? [{ id: 8, name: '专辑' }] : [] },
      });
    return response({ code: 200, result: { songs: direct, songCount: direct.length } });
  };
  return { calls, fetcher };
}

it('生产统一搜索携带同源凭证与取消信号，准确发送关键词、类型和分页参数', async () => {
  const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
  const controller = new AbortController();
  const fixture = coverSearchFixture({
    direct: [{ ...song(11), al: { name: '专辑', picUrl: 'https://p1.music.126.net/known.jpg' } }],
    artist: [{ ...song(11), al: { name: '专辑', picUrl: 'https://p1.music.126.net/known.jpg' } }],
  });
  const result = await createSongSearch(' 陈奕迅 ', fixture.fetcher, controller.signal).next();
  assert.deepEqual(
    result.items.map((item) => item.key),
    ['netease:11'],
  );
  for (const { options } of fixture.calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, controller.signal);
  }
  const searches = fixture.calls
    .map(({ address }) => new URL(address, 'http://localhost'))
    .filter((url) => url.pathname === '/api/netease/search');
  assert.deepEqual(
    searches.map((url) => Object.fromEntries(url.searchParams)),
    [
      { keywords: '陈奕迅', type: '100', limit: '1', offset: '0' },
      { keywords: '陈奕迅', type: '10', limit: '1', offset: '0' },
      { keywords: '陈奕迅', type: '1', limit: '30', offset: '0' },
    ],
  );
  assert.equal(
    fixture.calls.some(({ address }) => address.includes('/artist/songs?id=7&limit=30&offset=0')),
    true,
  );
});

it('当前页合并去重后批量补齐网易云缺失封面，保留本地、已有封面和不可信图片回退', async () => {
  const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
  const { FALLBACK_COVER } = await import('../frontend/src/shared/music.ts');
  const controller = new AbortController();
  const fixture = coverSearchFixture({
    direct: [
      song(11),
      { ...song(12), al: { name: '专辑', picUrl: 'https://p1.music.126.net/known.jpg' } },
      { ...song(13), al: { name: '专辑', picUrl: 'javascript:unsafe' } },
    ],
    artist: [song(11), song(14)],
    album: [song(15)],
    local: [
      { sourceId: '11', title: '匹配本地', artists: [], album: { name: '本地' }, durationMs: 1 },
    ],
    detail: async (_url, response) =>
      response({
        code: 200,
        songs: [
          { id: 11, al: { picUrl: 'http://p3.music.126.net/real.jpg' } },
          { id: 12, al: { picUrl: 'https://p1.music.126.net/unrequested.jpg' } },
          { id: 13, al: { picUrl: 'https://evil.test/private.jpg' } },
          { id: 14, al: { picUrl: 'https://p2.music.126.net/artist.jpg' } },
        ],
      }),
  });
  const result = await createSongSearch('匹配', fixture.fetcher, controller.signal).next();
  assert.deepEqual(
    result.items.map((item) => item.key),
    ['netease:11', 'netease:12', 'netease:13', 'netease:14', 'local:11', 'netease:15'],
  );
  assert.deepEqual(
    result.items.map((item) => item.coverUrl),
    [
      'https://p3.music.126.net/real.jpg',
      'https://p1.music.126.net/known.jpg',
      FALLBACK_COVER,
      'https://p2.music.126.net/artist.jpg',
      FALLBACK_COVER,
      FALLBACK_COVER,
    ],
  );
  const requests = fixture.calls.filter(({ address }) => address.includes('/song/detail'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].address, '/api/netease/song/detail?ids=11%2C13%2C14%2C15');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.signal, controller.signal);
  assert.equal(result.hasMore, false);
});

it('当前页网易云封面齐全时不请求详情，本地缺图不会触发网易云补齐', async () => {
  const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
  const fixture = coverSearchFixture({
    direct: [{ ...song(1), al: { name: '专辑', picUrl: 'https://p1.music.126.net/known.jpg' } }],
    local: [{ sourceId: '2', title: '匹配本地', artists: [], album: { name: null } }],
  });
  const result = await createSongSearch('匹配', fixture.fetcher).next();
  assert.equal(result.items.length, 2);
  assert.equal(
    fixture.calls.some(({ address }) => address.includes('/song/detail')),
    false,
  );
});

for (const failure of ['网络失败', 'HTTP失败', '业务失败', '解析失败', '结构错误']) {
  it(`封面详情${failure}时保留当前搜索结果和占位图`, async () => {
    const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
    const { FALLBACK_COVER } = await import('../frontend/src/shared/music.ts');
    const fixture = coverSearchFixture({
      direct: [song(11), song(12)],
      detail: async (_url, response) => {
        if (failure === '网络失败') throw new Error('上游内部路径');
        if (failure === 'HTTP失败') return response({ message: '上游内部路径' }, 502);
        if (failure === '业务失败') return response({ code: 500 });
        if (failure === '解析失败')
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('上游内部路径');
            },
          };
        return response({ code: 200, songs: {} });
      },
    });
    const result = await createSongSearch('词', fixture.fetcher).next();
    assert.deepEqual(
      result.items.map((item) => item.key),
      ['netease:11', 'netease:12'],
    );
    assert.ok(result.items.every((item) => item.coverUrl === FALLBACK_COVER));
    assert.doesNotMatch(result.warning, /内部路径/);
  });
}

for (const stage of ['响应', 'JSON']) {
  it(`封面${stage}迟到时，取消统一搜索不会交付旧结果`, async () => {
    const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
    const controller = new AbortController();
    let started, finish;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const delayed = new Promise((resolve) => {
      finish = resolve;
    });
    const fixture = coverSearchFixture({
      direct: [song(11)],
      detail: async (_url, response) => {
        if (stage === '响应') {
          started();
          return delayed;
        }
        return {
          ok: true,
          status: 200,
          json: async () => {
            started();
            return delayed;
          },
        };
      },
    });
    const pending = createSongSearch('词', fixture.fetcher, controller.signal).next();
    await waiting;
    controller.abort();
    const body = {
      code: 200,
      songs: [{ id: 11, al: { picUrl: 'https://p1.music.126.net/late.jpg' } }],
    };
    finish(stage === '响应' ? { ok: true, status: 200, json: async () => body } : body);
    await assert.rejects(pending, (error) => error.name === 'AbortError');
  });
}

for (const [query, expected] of [
  ['夜航', ['local:1', 'local:2']],
  ['测试歌手', ['local:1', 'local:2']],
  ['ALPHA', ['local:3']],
  ['无匹配', []],
]) {
  it(`当前统一搜索按本地歌曲标题、歌手和专辑匹配：${query}`, async () => {
    const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts');
    const fixture = coverSearchFixture({
      local: [
        {
          sourceId: '1',
          title: '第一首',
          artists: [{ name: '测试歌手' }],
          album: { name: '夜航' },
        },
        {
          sourceId: '2',
          title: '第二首',
          artists: [{ name: '测试歌手' }],
          album: { name: '夜航' },
        },
        { sourceId: '3', title: 'alpha', artists: [{ name: '其他歌手' }], album: { name: null } },
      ],
    });
    const result = await createSongSearch(query, fixture.fetcher).next();
    assert.deepEqual(
      result.items.map((item) => item.key),
      expected,
    );
    assert.ok(result.items.every((item) => item.kind === 'song' && item.source === 'local'));
  });
}
