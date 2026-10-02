const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const frontend = (name) => path.resolve(__dirname, '../frontend/src', name)

describe('全站共享图标与动画', () => {
  it('同形图标由同一个生成函数输出，播放保留搜索页实心三角，爱心支持两种状态', async () => {
    const { uiIcon, uiIcons } = await import(pathToFileURL(frontend('ui-icons.ts')).href)
    for (const [name, markup] of Object.entries(uiIcons)) {
      assert.equal(markup, uiIcon(name))
      assert.match(markup, new RegExp(`data-ui-icon="${name}"`))
      assert.match(markup, /aria-hidden="true"/)
    }
    assert.match(uiIcons.play, />▶<\/span>/)
    assert.match(uiIcons.close, />×<\/span>/)
    assert.match(uiIcon('heart', true), /fill="currentColor"/)
    assert.match(uiIcon('heart'), /fill="none"/)
    assert.notEqual(uiIcons.eye, uiIcons.eyeOff)
  })

  it('各页面和播放器复用图标组件，不在页面内重复定义图形或按钮图标文字', () => {
    for (const file of ['album-archive.ts', 'search-page.ts', 'user-page.ts', 'upload-page.ts', 'login-page.ts', 'entry-page.ts']) {
      const source = fs.readFileSync(frontend(file), 'utf8')
      assert.match(source, /from '\.\/ui-icons\.ts'/, file)
      assert.doesNotMatch(source, /const icons =|const icon =/, file)
      assert.doesNotMatch(source, /<button[^>]*>[^<]*[▶＋♡×←→↑↓↗]/, file)
    }
  })

  it('搜索、歌单和播放器的播放图标标记完全一致，上传及歌单关闭图标也一致', async () => {
    const { uiIcons } = await import(pathToFileURL(frontend('ui-icons.ts')).href)
    const { selectedMarkup } = await import(pathToFileURL(frontend('search-page.ts')).href)
    const { createAlbumArchiveMarkup } = await import(pathToFileURL(frontend('album-archive.ts')).href)
    const { createPlaylistHeaderMarkup, createUserPageMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const { createUploadPageMarkup } = await import(pathToFileURL(frontend('upload-page.ts')).href)
    const selected = selectedMarkup({key:'local:1',kind:'song',source:'local',sourceId:'1',title:'测试',artist:'歌手',album:'专辑',year:'2026',duration:'1:00',coverUrl:'/images/album-placeholder-01.svg',description:''})
    for (const markup of [selected, createAlbumArchiveMarkup(), createPlaylistHeaderMarkup({id:1,name:'歌单'},true)]) {
      assert.ok(markup.includes(uiIcons.play))
    }
    assert.ok(createUploadPageMarkup().includes(uiIcons.close))
    assert.ok(createUserPageMarkup().includes(uiIcons.close))
  })

  it('共享动画只变换图标：普通图标轻晃一次，× 平滑旋转，禁用及减少动态效果时不动', () => {
    const css = fs.readFileSync(frontend('style.css'), 'utf8')
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
