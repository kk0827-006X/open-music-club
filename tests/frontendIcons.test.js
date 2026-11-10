const { readFrontendSource } = require('./helpers/frontendSource')
const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

const frontend = (name) => path.resolve(__dirname, '../frontend/src', name)

describe('全站共享图标与动画', () => {
  it('真实 Icon 组件复用全部几何定义，播放与关闭保留字形，爱心支持两种状态', async () => {
    await withReactHarness(async h => {
      const { Icon } = await import('../frontend/src/shared/react/ui.tsx')
      const { glyphs, paths } = await import('../frontend/src/shared/ui/icons.ts')
      const names = [...Object.keys(glyphs), ...Object.keys(paths)]
      await h.render(h.React.createElement(h.React.Fragment, null, ...names.map(name => h.React.createElement(Icon, { key: name, name }))))
      for (const name of names) assert.equal(h.require(`[data-ui-icon="${name}"]`).getAttribute('aria-hidden'), 'true')
      assert.equal(h.require('[data-ui-icon="play"]').textContent, '▶')
      assert.equal(h.require('[data-ui-icon="close"]').textContent, '×')
      assert.equal(h.require('[data-ui-icon="heart"]').getAttribute('fill'), 'none')
      assert.notEqual(h.require('[data-ui-icon="eye"]').innerHTML, h.require('[data-ui-icon="eyeOff"]').innerHTML)
      await h.render(h.React.createElement(Icon, { name: 'heart', filled: true }))
      assert.equal(h.require('[data-ui-icon="heart"]').getAttribute('fill'), 'currentColor')
    })
  })

  it('各页面和播放器复用图标组件，不在页面内重复定义图形或按钮图标文字', () => {
    for (const file of ['features/player/PlayerView.tsx', 'features/user/UserPage.tsx', 'features/upload/UploadPage.tsx', 'features/auth/LoginPage.tsx', 'features/auth/EntryPage.tsx']) {
      const source = readFrontendSource(frontend(file))
      assert.match(source, /from ['"][^'"]*\/react\/ui\.tsx['"]/, file)
      assert.doesNotMatch(source, /const icons =|const icon =/, file)
      assert.doesNotMatch(source, /<button[^>]*>[^<]*[▶＋♡×←→↑↓↗]/, file)
    }
  })

  it('真实歌单和播放器使用相同播放图标，上传及歌单关闭图标也一致', async () => {
    await withReactHarness(async h => {
      const [{ PlayerView }, { PlaylistHeader, UserPage }, { UploadPage }, { MusicQueue }, { createPlayerController }] = await Promise.all([
        import('../frontend/src/features/player/PlayerView.tsx'), import('../frontend/src/features/user/UserPage.tsx'),
        import('../frontend/src/features/upload/UploadPage.tsx'), import('../frontend/src/features/queue/model.ts'),
        import('../frontend/src/features/player/player-core.ts'),
      ])
      const queue = new MusicQueue(), audio = new h.window.EventTarget()
      Object.assign(audio, { paused: true, volume: .62, currentTime: 0, pause() {}, removeAttribute() {}, load() {} })
      const player = createPlayerController({ queue, resolveUrl: async () => '', createAudio: () => audio })
      const root = h.React.createRef(); root.current = h.require('#app')
      const selectedAlbum = { title: '专辑', artist: '歌手', coverUrl: '/images/album-placeholder-01.svg', tracks: [] }
      const defaultTrack = { key: 'local:1', source: 'local', sourceId: '1', kind: 'song', title: '歌曲', artist: '歌手', album: '专辑', coverUrl: selectedAlbum.coverUrl }
      try {
        await h.render(h.React.createElement(h.React.Fragment, null,
          h.React.createElement(PlayerView, { player, queue, root, selectedAlbum, defaultTrack,
            personalLibrary: { queue: async () => [], saveQueue: async () => {}, isLiked: async () => false }, onExpandedChanged() {}, collectionChanged() {} }),
          h.React.createElement(PlaylistHeader, { list: { id: 1, name: '歌单' }, playable: true }),
          h.React.createElement(UploadPage, { active: false }), h.React.createElement(UserPage, { active: false })))
        const play = h.require('[data-player-toggle] [data-ui-icon="play"]').outerHTML
        assert.equal(h.require('[data-user-playlist-play] [data-ui-icon="play"]').outerHTML, play)
        const close = h.require('[data-upload-remove] [data-ui-icon="close"]').outerHTML
        assert.equal(h.require('[data-user-dialog-close] [data-ui-icon="close"]').outerHTML, close)
      } finally { await h.unmount(); player.destroy() }
    })
  })

  it('共享动画只变换图标：普通图标轻晃一次，× 平滑旋转，禁用及减少动态效果时不动', () => {
    const css = readFrontendSource(frontend('style.css'))
    assert.match(css, /button:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\) \.ui-icon\s*\{[^}]*animation: ui-icon-bob 420ms ease-in-out/)
    assert.match(css, /button:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\) \.ui-icon\[data-ui-icon="close"\]\s*\{[^}]*animation: none;[^}]*transform: rotate\(90deg\)/)
    assert.match(css, /\.ui-icon\s*\{[^}]*transition: transform 240ms ease/)
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n')
    assert.match(reduced, /\.ui-icon[^}]*animation: none/)
    assert.match(reduced, /\.ui-icon[^}]*transform: none/)
    assert.doesNotMatch(css, /animation: ui-icon-bob[^;]*infinite/)
    assert.doesNotMatch(css, /\.user-create-dialog header button:hover[^}]*rotate|\.upload-selected-row > button:hover[^}]*rotate/)
    assert.doesNotMatch(css, /\.upload-submit:hover span:last-child[^}]*transform|\.user-playlist-card:hover \.user-playlist-meta b[^}]*transform/)
  })
})
