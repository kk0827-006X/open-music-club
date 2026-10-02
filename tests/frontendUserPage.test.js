const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const frontend = (name) => path.resolve(__dirname, '../frontend/src', name)

describe('用户页面真实数据界面', () => {
  it('提供四个个人音乐入口及持久化状态，不再显示静态预览提示', async () => {
    const { createUserPageMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const markup = createUserPageMarkup()
    for (const section of ['playlists', 'favorites', 'recent', 'uploads']) {
      assert.match(markup, new RegExp(`data-user-tab="${section}"`))
    }
    assert.match(markup, /data-user-create/)
    assert.match(markup, /data-user-content/)
    assert.match(markup, /data-user-feedback/)
    assert.doesNotMatch(markup, /仅供界面预览|刷新后不会保留/)
    assert.doesNotMatch(markup, /UI PREVIEW|user-preview-tag/)
    assert.doesNotMatch(markup, /音乐成员/)
    assert.doesNotMatch(markup.match(/<nav class="user-section-nav"[\s\S]*?<\/nav>/)?.[0] ?? '', /<span>0[1-4]<\/span>/)
    assert.match(markup, /data-user-avatar-choose/)
    assert.match(markup, /type="file"[^>]*data-user-avatar-file/)
    assert.doesNotMatch(markup, /<audio|data-global-player/)
  })

  it('只接入原有导航容器，保留同一个全站播放器', () => {
    const archive = fs.readFileSync(frontend('album-archive.ts'), 'utf8')
    const css = fs.readFileSync(frontend('style.css'), 'utf8')
    assert.match(archive, /data-user-host/)
    assert.match(archive, /data-nav="user"[^>]*>/)
    assert.doesNotMatch(archive.match(/data-nav="user"[^>]*>/)?.[0] ?? '', /disabled/)
    assert.match(archive, /mountUserPage/)
    assert.match(archive, /\[data-nav="user"\]'\)\?\.addEventListener\('click', showUser\)/)
    assert.match(css, /\.user-page\s*\{[^}]*grid-template-columns/)
    assert.match(css, /\.album-archive\[data-view="user"\] \.user-page/)
    assert.equal((archive.match(/\$\{createPlayerMarkup\(selected\)\}/g) || []).length, 1)
  })

  it('用户页通过个人音乐库适配层接入，不重新创建播放器', () => {
    const source = fs.readFileSync(frontend('user-page.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|\/api\//)
    assert.doesNotMatch(source, /new Audio\s*\(/)
    assert.match(source, /personal-library-client/)
  })

  it('头像仅接受不超过 5 MB 的 JPG、PNG 和 WebP 图片', async () => {
    const { validateAvatarFile } = await import(pathToFileURL(frontend('user-page.ts')).href)
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      assert.equal(validateAvatarFile({ type, size: 5 * 1024 * 1024 }), null)
    }
    assert.match(validateAvatarFile({ type: 'image/svg+xml', size: 100 }), /JPG、PNG 或 WebP/)
    assert.match(validateAvatarFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/)
    assert.match(validateAvatarFile({ type: 'image/png', size: 0 }), /有效图片/)
  })

  it('歌单名称原位编辑，标题右侧只有播放和 × 删除', async () => {
    const { createPlaylistHeaderMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const { uiIcons } = await import(pathToFileURL(frontend('ui-icons.ts')).href)
    const markup = createPlaylistHeaderMarkup({ id: 1, name: '夜晚 <歌单>' }, true)
    assert.match(markup, /data-user-rename="1"/)
    assert.match(markup, /data-user-rename-form/)
    assert.match(markup, /aria-label="歌单名称"/)
    assert.match(markup, /夜晚 &lt;歌单&gt;/)
    assert.match(markup, /data-user-playlist-play/)
    assert.ok(markup.includes(`${uiIcons.play}</button>`))
    assert.ok(markup.includes(`${uiIcons.close}</button>`))
    assert.doesNotMatch(markup, />重命名<|>删除歌单</)
    assert.ok(markup.indexOf('data-user-playlist-play') < markup.indexOf('data-user-delete'))
    const disabled = createPlaylistHeaderMarkup({ id: 2, name: '空歌单' }, false)
    assert.match(disabled, /data-user-playlist-play[^>]*disabled/)
  })

  it('歌曲行仅保留统一播放图标、＋、爱心和 ×，不显示时长或加歌单', async () => {
    const { createUserTrackMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const { uiIcons } = await import(pathToFileURL(frontend('ui-icons.ts')).href)
    const track = { source: 'local', sourceId: '3', trackKey: 'local:3', title: '歌曲 <3>', artists: [{ name: '歌手' }], album: { name: '专辑' }, durationMs: 123000, coverUrl: null, playable: true, liked: false }
    const markup = createUserTrackMarkup(track, false, true)
    for (const name of ['play', 'plus', 'close']) assert.ok(markup.includes(`${uiIcons[name]}</button>`))
    assert.match(markup, /data-user-like="local:3"[^>]*aria-pressed="false"/)
    assert.match(markup, /歌曲 &lt;3&gt;/)
    assert.doesNotMatch(markup, /<time|2:03|data-user-save|>移除<|>取消喜爱</)
    const liked = createUserTrackMarkup(track, true, false)
    assert.match(liked, /data-user-like="local:3"[^>]*aria-pressed="true"/)
    assert.match(liked, /fill="currentColor"/)
    assert.doesNotMatch(liked, /data-user-remove/)
    const unavailable = createUserTrackMarkup({ ...track, playable: false }, false, true)
    assert.match(unavailable, /data-user-play="local:3"[^>]*disabled/)
    assert.match(unavailable, /data-user-enqueue="local:3"[^>]*disabled/)
  })

  it('歌单图标无圆圈及悬停背景，普通按钮轻晃一次，× 旋转 90 度并支持减少动态效果', () => {
    const css = fs.readFileSync(frontend('style.css'), 'utf8')
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

  it('删除歌单使用确认弹窗且明确不会删除音乐文件', async () => {
    const { createUserPageMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const markup = createUserPageMarkup()
    assert.match(markup, /<dialog[^>]*data-user-delete-dialog/)
    assert.match(markup, /data-user-delete-confirm/)
    assert.match(markup, /data-user-delete-cancel/)
    assert.match(markup, /不会删除音乐文件/)
  })

  it('播放歌单包含全部页的可用曲目，按顺序加入原队列并播放第一首', async () => {
    const { playPlaylistTracks } = await import(pathToFileURL(frontend('user-page.ts')).href)
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
