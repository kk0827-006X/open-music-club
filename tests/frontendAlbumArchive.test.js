const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')

function frontendModule(relativePath) {
  const modulePath = path.join(projectRoot, 'frontend/src', relativePath)
  return `${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`
}

describe('三维专辑档案 UI', () => {
  it('提供 24 张真实网易云专辑，分三排且每排 8 张', async () => {
    const { demoAlbums } = await import(frontendModule('album-data.ts'))
    const { archiveColumns, records, columnFiles } = await import(frontendModule('rhine/data.ts'))

    assert.equal(demoAlbums.length, 24)
    assert.equal(archiveColumns.length, 3)
    assert.equal(records.length, 24)
    assert.equal(new Set(records.map((record) => record.albumIndex)).size, 24)
    assert.deepEqual(archiveColumns.map((_, lane) => columnFiles(lane).length), [8, 8, 8])
    for (const album of demoAlbums) {
      assert.match(album.coverUrl, /^https:\/\/p[1-4]\.music\.126\.net\//)
      assert.match(album.id, /^\d+$/)
      assert.equal(album.tracks.length > 0, true)
      assert.match(album.tracks[0].id, /^\d+$/)
      assert.equal(typeof album.title, 'string')
      assert.equal(typeof album.artist, 'string')
    }
  })

  it('档案页为原 Three.js 场景提供画布容器，不再生成 CSS 卡片墙', async () => {
    const { createAlbumArchiveMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const markup = createAlbumArchiveMarkup()

    assert.match(markup, /data-three-scene/)
    assert.doesNotMatch(markup, /archive-case-field/)
    assert.match(markup, /ALBUM \/ SELECT/)
    assert.match(markup, /data-wave-field/)
    assert.match(markup, /data-album-information/)
    assert.equal((markup.match(/data-album-tick=/g) || []).length, 8)
    const secondRow = createAlbumArchiveMarkup(9)
    assert.match(secondRow, /data-album-tick="1" aria-label="当前排第 2 张专辑" aria-current="true"/)
    assert.doesNotMatch(markup, /\/api\//)
    assert.doesNotMatch(markup, /<audio/i)
  })

  it('档案墙复用原场景、模型和波动算法，不载入拆解模型', () => {
    const fs = require('node:fs')
    const scenePath = path.join(projectRoot, 'frontend/src/rhine/scene.ts')
    const motionPath = path.join(projectRoot, 'frontend/src/rhine/motion.ts')
    const modelPath = path.join(projectRoot, 'frontend/public/assets/archive-cassette.glb')

    assert.match(fs.readFileSync(scenePath, 'utf8'), /export class ArchiveScene/)
    assert.match(fs.readFileSync(scenePath, 'utf8'), /archiveWave\(/)
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(motionPath)).digest('hex'),
      '60c4bbef70f34f69e36ff60aa631b3b88b2eb42a6e9b431b6af3c6fd69eb744e'
    )
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'),
      'dda42b9b3b471d11c69820a64084d254a64b27761287ab0e35dd8387ec0a0bed'
    )
    assert.equal(fs.existsSync(path.join(projectRoot, 'frontend/public/assets/archive-assembly.glb')), false)
  })

  it('三维档案模型先完成加载，远程封面只作为随后更新的贴图', () => {
    const fs = require('node:fs')
    const scene = fs.readFileSync(path.join(projectRoot, 'frontend/src/rhine/scene.ts'), 'utf8')
    const ready = scene.indexOf('this.loaded = true;')
    const coverStart = scene.indexOf('this.startCoverLoading();')

    assert.ok(ready > 0 && coverStart > ready, '档案墙必须先可渲染，再请求远程封面')
    assert.doesNotMatch(scene, /this\.coverTextures\s*=\s*await Promise\.all/)
    assert.match(scene, /this\.coverInstances\.push\(instances\)/)
    assert.match(scene, /material\.map = texture/)
  })

  it('每张档案的封面平面位于实体正面，不会被原模型遮住', () => {
    const fs = require('node:fs')
    const scene = fs.readFileSync(path.join(projectRoot, 'frontend/src/rhine/scene.ts'), 'utf8')
    const model = fs.readFileSync(path.join(projectRoot, 'frontend/public/assets/archive-cassette.glb'))
    const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString())
    const front = Math.max(...gltf.meshes.flatMap((mesh) => mesh.primitives.map(
      (primitive) => gltf.accessors[primitive.attributes.POSITION].max[2],
    )))
    const coverDepth = Number(scene.match(/coverGeometry\.translate\(0, 1\.85, ([\d.]+)\)/)?.[1])

    assert.ok(coverDepth > front, '封面应在档案正面几何体之前')
    assert.match(scene, /this\.coverInstances\[albumIndex\]\.setMatrixAt/)
  })

  it('选中档案的封面保持原色，不被档案场景的主题着色覆盖', () => {
    const fs = require('node:fs')
    const scene = fs.readFileSync(path.join(projectRoot, 'frontend/src/rhine/scene.ts'), 'utf8')
    const appearance = fs.readFileSync(path.join(projectRoot, 'frontend/src/rhine/appearance.ts'), 'utf8')
    assert.match(scene, /this\.selectedCover\.userData\.preserveArtwork = true/)
    assert.match(appearance, /if \(mesh\.userData\.preserveArtwork\) continue/)
  })

  it('专辑详情加载完整曲目并逐首渲染可播放操作', async () => {
    const { demoAlbums, fetchAlbumTracks } = await import(frontendModule('album-data.ts'))
    const { createAlbumDetailMarkup } = await import(frontendModule('album-archive.ts'))
    const album = demoAlbums[3]
    const tracks = await fetchAlbumTracks(album.id, async (url, options) => {
      assert.equal(url, `/api/netease/album?id=${album.id}`)
      assert.equal(options.credentials, 'same-origin')
      return { ok: true, json: async () => ({ code: 200, songs: [
        { id: 67402, name: '黎喇', dt: 13000 },
        { id: 67403, name: '第二首', dt: 241000 },
      ] }) }
    })
    const markup = createAlbumDetailMarkup({ ...album, tracks, totalTracks: tracks.length })
    assert.equal(tracks.length, 2)
    assert.match(markup, /02.*第二首/s)
    assert.match(markup, /data-album-play="67403"/)
    assert.match(markup, /2 首/)
  })

  it('将来的收藏与最近播放可决定档案墙排序，缺少偏好时仍使用静态目录', async () => {
    const { demoAlbums } = await import(frontendModule('album-data.ts'))
    const { rankArchiveAlbums } = await import(frontendModule('rhine/data.ts'))
    const ordered = rankArchiveAlbums(demoAlbums, {
      favoriteAlbumIds: [demoAlbums[4].id, demoAlbums[2].id],
      recentAlbumIds: [demoAlbums[2].id, demoAlbums[7].id],
    })

    assert.deepEqual(ordered.slice(0, 3), [4, 2, 7])
    assert.equal(new Set(ordered).size, demoAlbums.length)
    assert.deepEqual(rankArchiveAlbums(demoAlbums), demoAlbums.map((_, index) => index))
  })

  it('顶部导航严格遵循设计文档的顺序、图标和激活状态', async () => {
    const { createAlbumArchiveMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const markup = createAlbumArchiveMarkup()

    assert.match(markup, /data-archive-navigation/)
    assert.match(markup, /data-nav="library"[^>]*aria-current="page"/)
    assert.ok(markup.indexOf('音乐库') < markup.indexOf('搜索'))
    assert.ok(markup.indexOf('搜索') < markup.indexOf('上传音乐'))
    const navigation = markup.match(/<nav class="archive-nav"[\s\S]*?<\/nav>/)?.[0]
    assert.ok(navigation)
    assert.ok(navigation.indexOf('上传音乐') < navigation.indexOf('用户'))
    assert.ok(navigation.indexOf('用户') < navigation.indexOf('设置'))
    assert.match(navigation, /data-nav="user"[^>]*disabled[^>]*>[^<]*<svg[\s\S]*?<span>用户<\/span>/)
    assert.doesNotMatch(navigation, /data-nav="queue"/)
    assert.ok((markup.match(/<svg/g) || []).length >= 5)
  })

  it('底部只渲染一套与设计图一致的全站播放器结构', async () => {
    const { createAlbumArchiveMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const markup = createAlbumArchiveMarkup()

    assert.equal((markup.match(/data-global-player/g) || []).length, 1)
    assert.match(markup, /data-player-track/)
    assert.match(markup, /data-player-progress/)
    assert.match(markup, /data-player-controls/)
    assert.match(markup, /data-player-volume/)
    assert.match(markup, /data-player-toggle/)
    assert.match(markup, /data-player-progress-bar/)
    assert.match(markup, /data-player-volume-input/)
    assert.match(markup, /data-player-queue-panel/)
    assert.match(markup, /data-queue-count>00/)
    assert.match(markup, /data-player-previous/)
    assert.match(markup, /data-player-next/)
    assert.match(markup, /NETEASE/)
    assert.match(markup, /GOOD MUSIC/)
    assert.doesNotMatch(markup, /PLAYER \/ STANDBY/)
  })

  it('原版海浪波包从所选档案向外传播并随时间衰减', async () => {
    const { baselineSelectionWave } = await import(frontendModule('rhine/motion.ts'))

    assert.equal(baselineSelectionWave(0, -1), 0)
    const source = baselineSelectionWave(0, 0.22)
    const nearby = baselineSelectionWave(2.2, 0.5)
    const distantEarly = baselineSelectionWave(8.8, 0.22)
    const settled = baselineSelectionWave(0, 3.3)

    assert.ok(Math.abs(source) > 0.05)
    assert.ok(Math.abs(nearby) > 0.01)
    assert.ok(Math.abs(distantEarly) < Math.abs(source))
    assert.equal(settled, 0)
  })

  it('专辑选择沿用循环索引，首尾切换不会反向跳跃', async () => {
    const { wrapAlbumIndex } = await import(frontendModule('album-archive.ts'))

    assert.equal(wrapAlbumIndex(-1), 23)
    assert.equal(wrapAlbumIndex(24), 0)
    assert.equal(wrapAlbumIndex(27), 3)
  })

  it('专辑详情包含封面、元数据、静态曲目列表和返回入口', async () => {
    const { createAlbumDetailMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const { demoAlbums } = await import(frontendModule('album-data.ts'))
    const markup = createAlbumDetailMarkup(demoAlbums[0])

    assert.match(markup, /data-back-to-archive/)
    assert.match(markup, /ALBUM DETAIL/)
    assert.match(markup, /代表曲目/)
    assert.match(markup, /data-album-play/)
    assert.match(markup, /data-album-queue/)
    assert.match(markup, new RegExp(demoAlbums[0].title))
    assert.doesNotMatch(markup, /<audio/i)
  })

  it('搜索页保留全站导航和播放器，提供真实来源筛选布局', async () => {
    const { createAlbumArchiveMarkup } = await import(frontendModule('album-archive.ts'))
    const { createSearchPageMarkup } = await import(frontendModule('search-page.ts'))
    const archive = createAlbumArchiveMarkup()
    const search = createSearchPageMarkup()

    assert.match(archive, /data-search-host/)
    assert.equal((archive.match(/data-global-player/g) || []).length, 1)
    assert.match(search, /data-search-input/)
    assert.match(search, /data-search-results/)
    assert.match(search, /data-search-selected/)
    assert.match(search, /data-search-source="netease"/)
    assert.match(search, /data-search-type="artist"/)
    assert.doesNotMatch(search, /演示|STATIC PREVIEW/)
    assert.doesNotMatch(search, /<audio|\/api\//i)
  })

  it('搜索页结果仍提供选择、来源和详情容器', async () => {
    const { createSearchPageMarkup, selectedMarkup } = await import(frontendModule('search-page.ts'))
    const markup = createSearchPageMarkup()

    assert.match(markup, /data-search-results/)
    assert.match(markup, /data-search-selected/)
    assert.match(markup, /data-search-count/)
    assert.match(markup, /data-search-empty/)
    assert.match(selectedMarkup({ kind: 'song', key: 'local:1', title: '测试歌曲', sourceId: '1', source: 'local', artist: '歌手', album: '专辑', coverUrl: '/images/album-placeholder-01.svg', year: '—', duration: '1:00', description: '' }), /data-search-play/)
  })
})
