const { readFrontendSource } = require('./helpers/frontendSource')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

const frontend = (name) => path.resolve(__dirname, '../frontend/src', name)

describe('用户页面真实数据界面', () => {
  it('提供四个个人音乐入口及持久化状态，不再显示静态预览提示', async () => {
    await withReactHarness(async h => {
      const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
      await h.render(h.React.createElement(UserPage, { active: false }))
      const page = h.require('[data-user-page]')
      for (const section of ['playlists', 'favorites', 'recent', 'uploads']) h.require(`[data-user-tab="${section}"]`)
      for (const selector of ['[data-user-create]', '[data-user-content]', '.sr-only[data-user-heading]', '[data-user-feedback]', '[data-user-avatar-choose]']) h.require(selector)
      assert.equal(h.require('[data-user-avatar-file]').type, 'file')
      assert.doesNotMatch(page.textContent, /PERSONAL COLLECTION|MY PLAYLISTS|仅供界面预览|刷新后不会保留|UI PREVIEW|音乐成员/)
      assert.equal(h.query('[data-user-subtitle], .user-preview-tag'), null)
      assert.equal(h.query('.user-section-nav span'), null)
      assert.equal(h.query('audio, [data-global-player]'), null)
    })
  })

  it('真实用户页通过 ref 暴露弹窗状态，卸载不留下第二套播放器', async () => {
    const css = readFrontendSource(frontend('style.css'))
    assert.match(css, /\.user-page\s*\{[^}]*grid-template-columns/)
    assert.match(css, /\.album-archive\[data-view="user"\] \.user-page/)
    await withReactHarness(async (h) => {
      const client = {
        profile: async () => ({ id: 1, nickname: '测试成员', avatarUrl: null }),
        playlists: async () => [],
        playlist: async () => null,
        likes: async () => [],
        uploads: async () => [],
      }
      const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
      const view = h.React.createRef()
      await h.render(h.React.createElement(UserPage, { ref: view, active: true, client }))
      await h.flush()
      h.require('[data-user-page]')
      assert.equal(view.current.hasOpenDialog, false)
      assert.equal(h.query('[data-global-player]'), null)
      assert.equal(h.query('audio'), null)
      await h.unmount()
      assert.equal(h.require('#app').childElementCount, 0)
      assert.equal(view.current, null)
    })
  })

  it('用户页通过个人音乐库适配层接入，不重新创建播放器', () => {
    const component = fs.readFileSync(frontend('features/user/UserPage.tsx'), 'utf8')
    assert.doesNotMatch(component, /fetch\s*\(|XMLHttpRequest|new Audio\s*\(/)
    assert.match(component, /services\/music\/personal-library/)
  })

  it('头像仅接受不超过 5 MB 的 JPG、PNG 和 WebP 图片', async () => {
    const { validateAvatarFile } = await import(pathToFileURL(frontend('features/user/UserPage.tsx')).href)
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      assert.equal(validateAvatarFile({ type, size: 5 * 1024 * 1024 }), null)
    }
    assert.match(validateAvatarFile({ type: 'image/svg+xml', size: 100 }), /JPG、PNG 或 WebP/)
    assert.match(validateAvatarFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/)
    assert.match(validateAvatarFile({ type: 'image/png', size: 0 }), /有效图片/)
  })

  it('歌单名称原位编辑，标题右侧只有播放和 × 删除', async () => {
    await withReactHarness(async h => {
      const { PlaylistHeader } = await import('../frontend/src/features/user/UserPage.tsx')
      await h.render(h.React.createElement(PlaylistHeader, { list: { id: 1, name: '夜晚 <歌单>' }, playable: true }))
      h.require('[data-user-rename="1"]'); h.require('[data-user-rename-form]'); h.require('[aria-label="歌单名称"]')
      assert.equal(h.require('[data-user-rename="1"]').textContent, '夜晚 <歌单>')
      assert.equal(h.require('[data-user-rename="1"]').childElementCount, 0, '歌单名称只能作为文本渲染')
      h.require('[data-user-playlist-play] [data-ui-icon="play"]'); h.require('[data-user-delete] [data-ui-icon="close"]')
      const actions = h.require('.user-list-detail-actions')
      assert.deepEqual([...actions.querySelectorAll('button')].map(button => button.getAttribute('aria-label')), ['播放歌单', '删除歌单'])
      assert.equal(actions.textContent, '▶×')
      await h.render(h.React.createElement(PlaylistHeader, { list: { id: 2, name: '空歌单' }, playable: false }))
      assert.equal(h.require('[data-user-playlist-play]').disabled, true)
    })
  })

  it('歌曲行仅保留统一播放图标、＋、爱心和 ×，不显示时长或加歌单', async () => {
    await withReactHarness(async h => {
      const { UserTrackRow } = await import('../frontend/src/features/user/UserPage.tsx')
      const track = { source: 'local', sourceId: '3', trackKey: 'local:3', title: '歌曲 <3>', artists: [{ name: '歌手' }], album: { name: '专辑' }, durationMs: 123000, coverUrl: null, playable: true, liked: false }
      const render = (track, liked, removable) => h.render(h.React.createElement(UserTrackRow, { track, liked, removable }))
      await render(track, false, true)
      for (const name of ['play', 'plus', 'close']) h.require(`.user-track-actions button [data-ui-icon="${name}"]`)
      assert.equal(h.require('[data-user-like="local:3"]').getAttribute('aria-pressed'), 'false')
      assert.equal(h.require('.user-track-row strong').textContent, '歌曲 <3>')
      assert.equal(h.require('.user-track-row strong').childElementCount, 0, '歌曲名称只能作为文本渲染')
      assert.equal(h.query('time, [data-user-save]'), null)
      assert.doesNotMatch(h.require('.user-track-row').textContent, /2:03|移除|取消喜爱/)
      await render(track, true, false)
      assert.equal(h.require('[data-user-like="local:3"]').getAttribute('aria-pressed'), 'true')
      assert.equal(h.require('[data-user-like] svg').getAttribute('fill'), 'currentColor')
      assert.equal(h.query('[data-user-remove]'), null)
      await render({ ...track, playable: false }, false, true)
      assert.equal(h.require('[data-user-play="local:3"]').disabled, true)
      assert.equal(h.require('[data-user-enqueue="local:3"]').disabled, true)
    })
  })

  it('歌单图标无圆圈及悬停背景，普通按钮轻晃一次，× 旋转 90 度并支持减少动态效果', () => {
    const css = readFrontendSource(frontend('style.css'))
    const base = css.match(/\.user-track-actions \.user-icon-button, \.user-list-detail-actions \.user-icon-button\s*\{([^}]+)\}/)?.[1] || ''
    assert.match(base, /border: 0/)
    assert.match(base, /border-radius: 0/)
    assert.match(base, /background: transparent/)
    assert.doesNotMatch(css, /\.user-play-button\s*\{[^}]*border-color/)
    const hover = css.match(/\.user-track-actions \.user-icon-button:hover:not\(:disabled\), \.user-list-detail-actions \.user-icon-button:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] || ''
    assert.match(hover, /background: transparent/)
    assert.match(hover, /transform: translateY\(0\)/)
    assert.doesNotMatch(hover, /border-color:|infinite/)
    assert.match(css, /data-ui-icon="close"[^}]*transform: rotate\(90deg\)/)
    assert.match(css, /@keyframes ui-icon-bob/)
    const reducedMotion = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n')
    assert.match(reducedMotion, /\.ui-icon[^}]*animation: none/)
    assert.match(reducedMotion, /\.ui-icon[^}]*transform: none/)
  })

  it('删除歌单使用真实确认弹窗且明确不会删除音乐文件', async () => {
    await withReactHarness(async (h) => {
      const list = { id: 1, name: '夜晚歌单', description: null, trackCount: 0, createdAt: '', updatedAt: '' }
      const client = {
        profile: async () => ({ id: 1, nickname: '测试成员', avatarUrl: null }),
        playlists: async () => [list],
        playlist: async () => ({ playlist: list, tracks: [] }),
        likes: async () => [],
        uploads: async () => [],
        deletePlaylist: async () => undefined,
      }
      const { UserPage } = await import('../frontend/src/features/user/UserPage.tsx')
      const view = h.React.createRef()
      await h.render(h.React.createElement(UserPage, { ref: view, active: true, client }))
      await h.until(() => {
        const card = h.query('[data-user-list="1"]')
        return Boolean(card && !card.disabled)
      }, '歌单卡片应完成加载并可点击')
      await h.click('[data-user-list="1"]')
      await h.until(() => {
        const remove = h.query('[data-user-delete="1"]')
        return Boolean(remove && !remove.disabled)
      }, '歌单详情应完成加载并渲染删除入口')
      await h.click('[data-user-delete="1"]')
      await h.until(() => view.current.hasOpenDialog === true, '删除确认弹窗应打开')
      const dialog = h.require('[data-user-delete-dialog]')
      assert.match(dialog.textContent, /不会删除音乐文件/)
      assert.match(h.require('[data-user-delete-name]').textContent, /夜晚歌单/)
      await h.click('[data-user-delete-cancel]')
      await h.until(() => view.current.hasOpenDialog === false, '取消后删除确认弹窗应关闭')
      await h.unmount()
      assert.equal(view.current, null)
    })
  })

  it('播放歌单包含全部页的可用曲目，按顺序加入原队列并播放第一首', async () => {
    const { playPlaylistTracks } = await import(pathToFileURL(frontend('features/user/UserPage.tsx')).href)
    const tracks = Array.from({ length: 7 }, (_, index) => ({ source: 'local', sourceId: String(index + 1), trackKey: `local:${index + 1}`, title: `歌曲${index + 1}`, artists: [], album: { name: null }, durationMs: 0, coverUrl: null, playable: index !== 1 }))
    const calls = []
    const count = await playPlaylistTracks(tracks, {
      enqueue: (song) => calls.push(`queue:${song.key}`),
      play: async (song) => calls.push(`play:${song.key}`),
    })
    assert.equal(count, 6)
    assert.deepEqual(calls, ['queue:local:1', 'queue:local:3', 'queue:local:4', 'queue:local:5', 'queue:local:6', 'queue:local:7', 'play:local:1'])
    calls.length = 0
    assert.equal(await playPlaylistTracks([], { play: async () => calls.push('play') }), 0)
    assert.deepEqual(calls, [])
    await assert.rejects(() => playPlaylistTracks(tracks, { play: async () => { throw new Error('播放失败') } }), /播放失败/)
  })
})
