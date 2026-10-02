const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const frontend = (name) => path.resolve(__dirname, '../frontend/src', name)

describe('用户页面静态界面', () => {
  it('提供四个个人音乐入口、歌单预览与清楚的非持久化提示', async () => {
    const { createUserPageMarkup } = await import(pathToFileURL(frontend('user-page.ts')).href)
    const markup = createUserPageMarkup()
    for (const section of ['playlists', 'favorites', 'recent', 'uploads']) {
      assert.match(markup, new RegExp(`data-user-tab="${section}"`))
    }
    assert.match(markup, /data-user-create/)
    assert.match(markup, /data-user-content/)
    assert.match(markup, /仅供界面预览/)
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
    assert.equal((archive.match(/\$\{playerMarkup\(selected\)\}/g) || []).length, 1)
  })

  it('用户页不请求后端或修改播放器业务逻辑', () => {
    const source = fs.readFileSync(frontend('user-page.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|\/api\//)
    assert.doesNotMatch(source, /new Audio\s*\(/)
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
})
