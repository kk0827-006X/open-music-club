const { readFrontendSource } = require('./helpers/frontendSource');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { describe, it } = require('node:test');
const { pathToFileURL } = require('node:url');
const { withReactHarness } = require('./helpers/reactHarness');

const projectRoot = path.resolve(__dirname, '..');

function frontendModule(relativePath) {
  const modulePath = path.join(projectRoot, 'frontend/src', relativePath);
  return `${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`;
}

// 工作区直接使用生产队列和播放器，只隔离音频与三维硬件，不保留旧 SSR 预览器。
async function withArchive(run, initialIndex = 0) {
  return withReactHarness(async (h) => {
    const [{ default: Workspace }, { MusicQueue }, { createPlayerController }] = await Promise.all([
      import('../frontend/src/app/Workspace.tsx'),
      import('../frontend/src/features/queue/model.ts'),
      import('../frontend/src/features/player/player-core.ts'),
    ]);
    const queue = new MusicQueue();
    const audio = new h.window.EventTarget();
    Object.assign(audio, {
      paused: true,
      volume: 0.62,
      currentTime: 0,
      pause() {},
      removeAttribute() {},
      load() {},
    });
    const player = createPlayerController({
      queue,
      resolveUrl: async () => {
        throw new Error('结构验收不应请求播放地址');
      },
      createAudio: () => audio,
    });
    const personalLibrary = {
      queue: async () => [],
      saveQueue: async () => {},
      isLiked: async () => false,
    };
    const loadScene = async () => ({
      load: async () => {},
      dispose() {},
      setReduced() {},
      setMode() {},
      select() {},
      resize() {},
      update() {},
      detailVisibility: 0,
    });
    try {
      await h.render(
        h.React.createElement(Workspace, {
          player,
          queue,
          personalLibrary,
          loadScene,
          initialIndex,
        }),
      );
      await run(h);
    } finally {
      await h.unmount();
      player.destroy();
    }
  });
}

describe('三维专辑档案 UI', () => {
  it('提供 24 张真实网易云专辑，分三排且每排 8 张', async () => {
    const { demoAlbums } = await import(frontendModule('features/music-library/album-data.ts'));
    const { archiveColumns, records, columnFiles } = await import(frontendModule('rhine/data.ts'));

    assert.equal(demoAlbums.length, 24);
    assert.equal(archiveColumns.length, 3);
    assert.equal(records.length, 24);
    assert.equal(new Set(records.map((record) => record.albumIndex)).size, 24);
    assert.deepEqual(
      archiveColumns.map((_, lane) => columnFiles(lane).length),
      [8, 8, 8],
    );
    for (const album of demoAlbums) {
      assert.match(album.coverUrl, /^https:\/\/p[1-4]\.music\.126\.net\//);
      assert.match(album.id, /^\d+$/);
      assert.equal(album.tracks.length > 0, true);
      assert.match(album.tracks[0].id, /^\d+$/);
      assert.equal(typeof album.title, 'string');
      assert.equal(typeof album.artist, 'string');
    }
  });

  it('档案页为原 Three.js 场景提供画布容器，不再生成 CSS 卡片墙', async () => {
    await withArchive(async (h) => {
      h.require('[data-three-scene]');
      assert.equal(h.query('.archive-case-field'), null);
      assert.match(h.require('.archive-callout').textContent, /ALBUM \/ SELECT/);
      h.require('[data-wave-field]');
      h.require('[data-album-information]');
      assert.equal(h.document.querySelectorAll('[data-album-tick]').length, 8);
      assert.equal(h.query('audio'), null);
    });
    await withArchive(async (h) => {
      const tick = h.require('[data-album-tick="1"]');
      assert.equal(tick.getAttribute('aria-label'), '当前排第 2 张专辑');
      assert.equal(tick.getAttribute('aria-current'), 'true');
    }, 9);
  });

  it('档案墙保留原波动算法和模型，允许已审查的音频阻尼扩展，不载入拆解模型', () => {
    const fs = require('node:fs');
    const scenePath = path.join(projectRoot, 'frontend/src/rhine/scene.ts');
    const motionPath = path.join(projectRoot, 'frontend/src/rhine/motion.ts');
    const modelPath = path.join(projectRoot, 'frontend/public/assets/archive-cassette.glb');

    assert.match(readFrontendSource(scenePath), /export class ArchiveScene/);
    assert.match(
      readFrontendSource(path.join(projectRoot, 'frontend/src/rhine/scene-update.ts')),
      /archiveWave\(/,
    );
    const motion = fs.readFileSync(motionPath, 'utf8');
    // 音乐响应仅在文件末尾扩展阻尼；原算法仍逐字锁定，不能通过更新整文件哈希掩盖变化。
    assert.equal(
      crypto
        .createHash('sha256')
        .update(motion.split('\n// 帧率无关的一阶阻尼，共用于音频包络和交互强度过渡。')[0])
        .digest('hex'),
      '60c4bbef70f34f69e36ff60aa631b3b88b2eb42a6e9b431b6af3c6fd69eb744e',
    );
    assert.equal(
      crypto.createHash('sha256').update(motion).digest('hex'),
      '53a08516427628a5ace785b8c4aa1eb570eccf0e16fd8ff152cd756d8649de01',
    );
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'),
      'dda42b9b3b471d11c69820a64084d254a64b27761287ab0e35dd8387ec0a0bed',
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, 'frontend/public/assets/archive-assembly.glb')),
      false,
    );
  });

  it('新增音频阻尼在不同帧率下收敛一致，无时间推进时不改变强度且不越过目标', async () => {
    const { approach } = await import(frontendModule('rhine/motion.ts'));
    for (const [start, target] of [
      [0, 1],
      [1, 0],
      [0.2, 0.8],
    ]) {
      const oneSecond = approach(start, target, 7, 1);
      for (const fps of [15, 30, 60, 144]) {
        let value = start;
        for (let frame = 0; frame < fps; frame++) {
          const next = approach(value, target, 7, 1 / fps);
          assert.ok(next >= Math.min(value, target) && next <= Math.max(value, target));
          value = next;
        }
        assert.ok(Math.abs(value - oneSecond) < 1e-12, `${fps} FPS 的包络应与相同总时长一致`);
      }
      assert.equal(approach(start, target, 7, 0), start);
      assert.equal(approach(start, target, 7, -1), start);
      assert.equal(approach(start, target, 0, 1), start);
      assert.equal(approach(start, target, 7, 100), target);
    }
  });

  it('三维档案模型先完成加载，远程封面只作为随后更新的贴图', () => {
    const fs = require('node:fs');
    const scene = readFrontendSource(path.join(projectRoot, 'frontend/src/rhine/scene-assets.ts'));
    const ready = scene.indexOf('this.context.markLoaded();');
    const coverStart = scene.indexOf('this.startCoverLoading();');

    assert.ok(ready > 0 && coverStart > ready, '档案墙必须先可渲染，再请求远程封面');
    assert.doesNotMatch(scene, /this\.coverTextures\s*=\s*await Promise\.all/);
    assert.match(scene, /this\.coverInstances\.push\(instances\)/);
    assert.match(scene, /material\.map = texture/);
  });

  it('每张档案的封面平面位于实体正面，不会被原模型遮住', () => {
    const fs = require('node:fs');
    const scene = readFrontendSource(path.join(projectRoot, 'frontend/src/rhine/scene-assets.ts'));
    const model = fs.readFileSync(
      path.join(projectRoot, 'frontend/public/assets/archive-cassette.glb'),
    );
    const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString());
    const front = Math.max(
      ...gltf.meshes.flatMap((mesh) =>
        mesh.primitives.map((primitive) => gltf.accessors[primitive.attributes.POSITION].max[2]),
      ),
    );
    const coverDepth = Number(scene.match(/coverGeometry\.translate\(0, 1\.85, ([\d.]+)\)/)?.[1]);

    assert.ok(coverDepth > front, '封面应在档案正面几何体之前');
    assert.match(
      readFrontendSource(path.join(projectRoot, 'frontend/src/rhine/scene-update.ts')),
      /assets\.coverInstances\[albumIndex\]\.setMatrixAt/,
    );
  });

  it('选中档案的封面保持原色，不被档案场景的主题着色覆盖', () => {
    const fs = require('node:fs');
    const scene = readFrontendSource(path.join(projectRoot, 'frontend/src/rhine/scene-assets.ts'));
    const appearance = readFrontendSource(
      path.join(projectRoot, 'frontend/src/rhine/appearance.ts'),
    );
    assert.match(scene, /this\.selectedCover\.userData\.preserveArtwork = true/);
    assert.match(appearance, /if \(mesh\.userData\.preserveArtwork\) continue/);
  });

  it('专辑详情加载完整曲目并逐首渲染可播放操作', async () => {
    const { demoAlbums, fetchAlbumTracks } = await import(
      frontendModule('features/music-library/album-data.ts')
    );
    const album = demoAlbums[3];
    const tracks = await fetchAlbumTracks(album.id, async (url, options) => {
      assert.equal(url, `/api/netease/album?id=${album.id}`);
      assert.equal(options.credentials, 'same-origin');
      return {
        ok: true,
        json: async () => ({
          code: 200,
          songs: [
            { id: 67402, name: '黎喇', dt: 13000 },
            { id: 67403, name: '第二首', dt: 241000 },
          ],
        }),
      };
    });
    assert.equal(tracks.length, 2);
    await withReactHarness(async (h) => {
      const { AlbumDetail } =
        await import('../frontend/src/features/music-library/LibraryView.tsx');
      const played = [],
        enqueued = [];
      await h.render(
        h.React.createElement(AlbumDetail, {
          album: { ...album, tracks, totalTracks: tracks.length },
          onPlay: (id) => played.push(id),
          onEnqueue: (id) => enqueued.push(id),
        }),
      );
      assert.match(h.require('.detail-track-preview ol').textContent, /02.*第二首/s);
      assert.match(h.require('.detail-album-actions').textContent, /2 首/);
      await h.click('[data-album-play="67403"]');
      await h.click('[data-album-queue="67402"]');
      assert.deepEqual(played, ['67403']);
      assert.deepEqual(enqueued, ['67402']);
    });
  });

  it('将来的收藏与最近播放可决定档案墙排序，缺少偏好时仍使用静态目录', async () => {
    const { demoAlbums } = await import(frontendModule('features/music-library/album-data.ts'));
    const { rankArchiveAlbums } = await import(frontendModule('rhine/data.ts'));
    const ordered = rankArchiveAlbums(demoAlbums, {
      favoriteAlbumIds: [demoAlbums[4].id, demoAlbums[2].id],
      recentAlbumIds: [demoAlbums[2].id, demoAlbums[7].id],
    });

    assert.deepEqual(ordered.slice(0, 3), [4, 2, 7]);
    assert.equal(new Set(ordered).size, demoAlbums.length);
    assert.deepEqual(
      rankArchiveAlbums(demoAlbums),
      demoAlbums.map((_, index) => index),
    );
  });

  it('顶部导航严格遵循设计文档的顺序、图标和激活状态', async () => {
    await withArchive(async (h) => {
      const nav = h.require('[data-archive-navigation]');
      assert.equal(h.require('[data-nav="library"]').getAttribute('aria-current'), 'page');
      assert.deepEqual(
        [...nav.querySelectorAll('button[data-nav]')].map((button) => button.dataset.nav),
        ['library', 'search', 'upload', 'footprint', 'user', 'settings'],
      );
      assert.match(h.require('[data-nav="user"] span').textContent, /用户/);
      h.require('[data-nav="user"] svg');
      assert.equal(h.require('[data-nav="user"]').disabled, false);
      assert.equal(h.query('[data-nav="queue"]'), null);
      assert.ok(h.document.querySelectorAll('svg').length >= 5);
    });
  });

  it('底部只渲染一套与设计图一致的全站播放器结构', async () => {
    await withArchive(async (h) => {
      assert.equal(h.document.querySelectorAll('[data-global-player]').length, 1);
      for (const selector of [
        'track',
        'progress',
        'controls',
        'volume',
        'toggle',
        'progress-bar',
        'volume-input',
        'queue-panel',
        'previous',
        'next',
      ])
        h.require(`[data-player-${selector}]`);
      assert.equal(h.require('[data-queue-count]').textContent, '00');
      assert.match(h.require('[data-global-player]').textContent, /NETEASE/);
      assert.match(h.require('[data-global-player]').textContent, /GOOD MUSIC/);
      assert.doesNotMatch(h.require('[data-global-player]').textContent, /PLAYER \/ STANDBY/);
    });
  });

  it('原版海浪波包从所选档案向外传播并随时间衰减', async () => {
    const { baselineSelectionWave } = await import(frontendModule('rhine/motion.ts'));

    assert.equal(baselineSelectionWave(0, -1), 0);
    const source = baselineSelectionWave(0, 0.22);
    const nearby = baselineSelectionWave(2.2, 0.5);
    const distantEarly = baselineSelectionWave(8.8, 0.22);
    const settled = baselineSelectionWave(0, 3.3);

    assert.ok(Math.abs(source) > 0.05);
    assert.ok(Math.abs(nearby) > 0.01);
    assert.ok(Math.abs(distantEarly) < Math.abs(source));
    assert.equal(settled, 0);
  });

  it('专辑选择通过真实 LibraryView 循环导航，首尾保持原场景记录顺序', async () => {
    await withReactHarness(async (h) => {
      const { LibraryView } =
        await import('../frontend/src/features/music-library/LibraryView.tsx');
      const { records, columnFiles } = await import('../frontend/src/rhine/data.ts');
      const { demoAlbums } = await import('../frontend/src/features/music-library/album-data.ts');
      const view = h.React.createRef(),
        selected = [];
      const scene = { ready: true, select: (index) => selected.push(index) };
      const files = columnFiles(0);
      await h.render(
        h.React.createElement(LibraryView, {
          ref: view,
          scene,
          actions: {},
          active: true,
          initialIndex: records[files[0]].albumIndex,
          onSelected() {},
          onModeChanged() {},
        }),
      );
      await h.click('[data-album-previous]');
      assert.equal(selected.at(-1), files.at(-1));
      assert.equal(view.current.selectedAlbum, demoAlbums[records[files.at(-1)].albumIndex]);
      await h.click('[data-album-next]');
      assert.equal(selected.at(-1), files[0]);
      for (let n = 0; n < files.length + 3; n++) await h.click('[data-album-next]');
      assert.equal(selected.at(-1), files[3]);
    });
  });

  it('专辑详情包含封面、元数据、曲目列表和真实返回入口', async () => {
    await withReactHarness(async (h) => {
      const { AlbumDetail } =
        await import('../frontend/src/features/music-library/LibraryView.tsx');
      const { demoAlbums } = await import('../frontend/src/features/music-library/album-data.ts');
      let closed = 0;
      await h.render(
        h.React.createElement(AlbumDetail, {
          album: demoAlbums[0],
          onClose: () => {
            closed++;
          },
        }),
      );
      h.require('.detail-cover img');
      h.require('[data-album-play]');
      h.require('[data-album-queue]');
      assert.match(h.require('[data-detail-information]').textContent, /ALBUM DETAIL/);
      assert.equal(h.require('[data-detail-information] h2').textContent, demoAlbums[0].title);
      assert.equal(h.query('audio'), null);
      await h.click('[data-back-to-archive]');
      assert.equal(closed, 1);
    });
  });

  it('旧搜索页及兼容入口已移除，档案仍只持有一个播放器', async () => {
    const fs = require('node:fs');
    await withArchive(async (h) => {
      assert.equal(h.query('[data-search-host], [data-search-page]'), null);
      assert.equal(h.document.querySelectorAll('[data-global-player]').length, 1);
      h.require('[data-nav="search"]');
    });
    for (const name of [
      'search-page.ts',
      'features/search/SearchPage.tsx',
      'features/search/search-page.ts',
      'styles/search.css',
    ]) {
      assert.equal(fs.existsSync(path.join(projectRoot, 'frontend/src', name)), false);
    }
  });
});

it('播放全部仅在完整曲目就绪后可用，按专辑顺序传递所有歌曲并阻止重复点击', async () => {
  await withReactHarness(async (h) => {
    const { AlbumDetail } = await import(frontendModule('features/music-library/LibraryView.tsx'));
    const { demoAlbums } = await import(frontendModule('features/music-library/album-data.ts'));
    const album = {
      ...demoAlbums[0],
      totalTracks: 2,
      tracks: [
        { id: '101', title: '第一首', duration: '1:00' },
        { id: '102', title: '第二首', duration: '2:00' },
      ],
    };
    const calls = [];
    let finish;
    const onPlayAll = (tracks) => {
      calls.push(tracks);
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const render = (state) =>
      h.render(h.React.createElement(AlbumDetail, { album, trackState: state, onPlayAll }));
    await render('loading');
    assert.equal(h.require('[data-album-play-all]').disabled, true);
    await render('unavailable');
    assert.equal(h.require('[data-album-play-all]').disabled, true);
    await render('ready');
    await h.click('[data-album-play-all]');
    await h.React.act(async () => h.require('[data-album-play-all]').click());
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].map((track) => [track.key, track.album]),
      [
        ['netease:101', album.title],
        ['netease:102', album.title],
      ],
    );
    assert.equal(h.require('[data-album-play-all]').disabled, true);
    await h.React.act(async () => finish());
    await h.flush();
    assert.equal(h.require('[data-album-play-all]').disabled, false);
    await h.render(
      h.React.createElement(AlbumDetail, { album: { ...album, tracks: [] }, onPlayAll }),
    );
    assert.equal(h.require('[data-album-play-all]').disabled, true);
  });
});
