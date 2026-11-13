const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');

function frontendModule(relativePath) {
  return `${pathToFileURL(path.resolve(__dirname, '../frontend/src', relativePath)).href}?test=${Date.now()}-${Math.random()}`;
}

describe('真实音乐搜索数据转换', () => {
  it('本地歌曲按专辑和歌手归组，仍保留来源与歌曲身份', async () => {
    const { toLocalSearchItems, filterSearchItems } = await import(
      frontendModule('services/music/search.ts')
    );
    const tracks = [
      {
        trackKey: 'local:1',
        sourceId: '1',
        source: 'local',
        title: '第一首',
        artists: [{ id: null, name: '测试歌手' }],
        album: { id: null, name: '夜航' },
        durationMs: 63000,
        coverUrl: '/api/local/music/1/cover',
        uploadedBy: { nickname: '成员甲' },
      },
      {
        trackKey: 'local:2',
        sourceId: '2',
        source: 'local',
        title: '第二首',
        artists: [{ id: null, name: '测试歌手' }],
        album: { id: null, name: '夜航' },
        durationMs: 120000,
        coverUrl: null,
        uploadedBy: { nickname: '成员乙' },
      },
      {
        trackKey: 'local:3',
        sourceId: '3',
        source: 'local',
        title: '未归档',
        artists: [{ id: null, name: '其他歌手' }],
        album: { id: null, name: null },
        durationMs: null,
        coverUrl: null,
      },
    ];
    const items = toLocalSearchItems(tracks);

    assert.equal(filterSearchItems(items, '夜航', 'local', 'song').length, 2);
    assert.equal(filterSearchItems(items, '夜航', 'local', 'album').length, 1);
    assert.equal(filterSearchItems(items, '测试歌手', 'local', 'artist').length, 1);
    assert.equal(filterSearchItems(items, '', 'local', 'album').length, 1);
    assert.equal(items.find((item) => item.key === 'local:1').duration, '1:03');
    assert.equal(items.find((item) => item.key === 'local:1').coverUrl, '/api/local/music/1/cover');
    assert.equal(items.find((item) => item.key === 'local:1').source, 'local');
  });

  it('网易云歌曲、专辑、歌手结果分别转换，非法封面不会进入页面', async () => {
    const { toNeteaseSearchItems } = await import(frontendModule('services/music/search.ts'));
    const song = toNeteaseSearchItems(
      {
        code: 200,
        result: {
          songs: [
            {
              id: 11,
              name: '十年',
              artists: [{ id: 7, name: '陈奕迅' }],
              album: { id: 9, name: '黑·白·灰', picUrl: 'http://p1.music.126.net/cover.jpg' },
              duration: 205000,
            },
          ],
        },
      },
      'song',
    );
    const album = toNeteaseSearchItems(
      {
        code: 200,
        result: {
          albums: [
            {
              id: 9,
              name: '黑·白·灰',
              artist: { id: 7, name: '陈奕迅' },
              picUrl: 'https://p1.music.126.net/album.jpg',
            },
          ],
        },
      },
      'album',
    );
    const artist = toNeteaseSearchItems(
      {
        code: 200,
        result: { artists: [{ id: 7, name: '陈奕迅', picUrl: 'javascript:alert(1)' }] },
      },
      'artist',
    );

    assert.equal(song[0].key, 'netease:song:11');
    assert.equal(song[0].artist, '陈奕迅');
    assert.equal(song[0].duration, '3:25');
    assert.equal(song[0].coverUrl, 'https://p1.music.126.net/cover.jpg');
    assert.equal(album[0].title, '黑·白·灰');
    assert.equal(album[0].artist, '陈奕迅');
    assert.equal(artist[0].title, '陈奕迅');
    assert.match(artist[0].coverUrl, /album-placeholder/);
  });

  it('歌曲播放地址按来源取得，并拒绝空 URL 与不可信域名', async () => {
    const { resolvePlaybackUrl } = await import(frontendModule('services/music/search.ts'));
    const local = { kind: 'song', source: 'local', sourceId: '12' };
    assert.equal(await resolvePlaybackUrl(local), '/api/local/music/12/stream');
    const fetcher = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { code: 200, data: [{ url: 'http://m801.music.126.net/song.mp3' }] };
      },
    });
    assert.equal(
      await resolvePlaybackUrl({ kind: 'song', source: 'netease', sourceId: '11' }, fetcher),
      'https://m801.music.126.net/song.mp3',
    );
    const empty = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { code: 200, data: [{ url: null }] };
      },
    });
    await assert.rejects(
      () => resolvePlaybackUrl({ kind: 'song', source: 'netease', sourceId: '11' }, empty),
      /暂不可播放/,
    );
    const unsafe = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { code: 200, data: [{ url: 'https://example.com/evil.mp3' }] };
      },
    });
    await assert.rejects(
      () => resolvePlaybackUrl({ kind: 'song', source: 'netease', sourceId: '11' }, unsafe),
      /暂不可播放/,
    );
  });

  it('本地列表使用现有接口，服务失败只给安全错误', async () => {
    const { fetchLocalSearchItems } = await import(frontendModule('services/music/search.ts'));
    const requests = [];
    const fetcher = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, tracks: [] };
        },
      };
    };
    assert.deepEqual(await fetchLocalSearchItems(fetcher), []);
    assert.equal(requests[0].url, '/api/local/music');
    assert.equal(requests[0].options.credentials, 'same-origin');

    const failing = async () => ({
      ok: false,
      status: 502,
      async json() {
        return { message: '上游内部路径和密钥' };
      },
    });
    await assert.rejects(() => fetchLocalSearchItems(failing), /本地音乐暂时无法加载/);
  });
});
