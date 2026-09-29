const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const frontendFile = (name) => path.join(root, 'frontend/src', name)

describe('本地音乐上传页 UI', () => {
  it('按照设计图提供文件拖放、Metadata、封面预览和固定 LOCAL 来源', async () => {
    const { createUploadPageMarkup } = await import(pathToFileURL(frontendFile('upload-page.ts')).href)
    const markup = createUploadPageMarkup()
    assert.match(markup, /data-upload-page/)
    assert.match(markup, /data-upload-dropzone/)
    assert.match(markup, /type="file"[^>]*data-upload-file/)
    assert.match(markup, /data-upload-cover/)
    assert.match(markup, /data-upload-title/)
    assert.match(markup, /data-upload-artist/)
    assert.match(markup, /data-upload-album/)
    assert.match(markup, /LOCAL/)
    assert.match(markup, /MP3[^<]*FLAC[^<]*WAV[^<]*M4A[^<]*OGG/)
    assert.match(markup, /100 MB/)
    assert.match(markup, /data-upload-submit/)
  })

  it('只做本地预览，按钮不向后端发送文件', () => {
    const source = fs.readFileSync(frontendFile('upload-page.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|\/api\/local\/music/)
    assert.match(source, /尚未接入上传接口/)
  })

  it('从音乐库和搜索页平滑切换到上传页，播放器保持同一个实例', () => {
    const archive = fs.readFileSync(frontendFile('album-archive.ts'), 'utf8')
    const css = fs.readFileSync(frontendFile('style.css'), 'utf8')
    assert.match(archive, /data-upload-host/)
    assert.match(archive, /data-nav="upload"[^\n]*addEventListener\('click', showUpload\)/)
    assert.match(archive, /view: 'archive' \| 'search' \| 'upload'/)
    assert.match(css, /\.upload-page\s*\{[^}]*opacity: 0[^}]*transition: opacity/)
    assert.match(css, /\.album-archive\[data-view="upload"\] \.upload-page\s*\{[^}]*opacity: 1/)
    assert.match(css, /\.album-archive\[data-view="upload"\] \.archive-brand/)
  })
})
