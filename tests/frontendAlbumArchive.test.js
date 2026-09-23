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
  it('提供 5 张静态专辑和可复用的本地占位封面', async () => {
    const { demoAlbums } = await import(frontendModule('album-data.ts'))

    assert.equal(demoAlbums.length, 5)
    for (const album of demoAlbums) {
      assert.match(album.coverUrl, /^\/images\/album-placeholder-0[1-5]\.svg$/)
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

  it('顶部导航严格遵循设计文档的顺序、图标和激活状态', async () => {
    const { createAlbumArchiveMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const markup = createAlbumArchiveMarkup()

    assert.match(markup, /data-archive-navigation/)
    assert.match(markup, /data-nav="library"[^>]*aria-current="page"/)
    assert.ok(markup.indexOf('音乐库') < markup.indexOf('搜索'))
    assert.ok(markup.indexOf('搜索') < markup.indexOf('上传音乐'))
    assert.ok(markup.indexOf('上传音乐') < markup.indexOf('队列'))
    assert.ok(markup.indexOf('队列') < markup.indexOf('设置'))
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
    assert.match(markup, /LOCAL/)
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

    assert.equal(wrapAlbumIndex(-1), 4)
    assert.equal(wrapAlbumIndex(5), 0)
    assert.equal(wrapAlbumIndex(7), 2)
  })

  it('专辑详情包含封面、元数据、静态曲目列表和返回入口', async () => {
    const { createAlbumDetailMarkup } = await import(
      frontendModule('album-archive.ts')
    )
    const { demoAlbums } = await import(frontendModule('album-data.ts'))
    const markup = createAlbumDetailMarkup(demoAlbums[0])

    assert.match(markup, /data-back-to-archive/)
    assert.match(markup, /ALBUM DETAIL/)
    assert.match(markup, /曲目预览/)
    assert.match(markup, new RegExp(demoAlbums[0].title))
    assert.doesNotMatch(markup, /<audio/i)
  })
})
