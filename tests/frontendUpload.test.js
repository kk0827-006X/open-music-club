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

  it('页面不直接构造网络请求，上传逻辑统一交给客户端适配层', () => {
    const source = fs.readFileSync(frontendFile('upload-page.ts'), 'utf8')
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|\/api\/local\/music/)
    assert.match(source, /uploadMusicFile/)
    assert.match(source, /内嵌封面/)
  })

  it('获取 CSRF Token 后使用会话和 FormData 上传，不手工设置 multipart 边界', async () => {
    const { uploadMusicFile } = await import(pathToFileURL(frontendFile('upload-client.ts')).href)
    const calls = []
    const fetcher = async (url, options) => {
      calls.push({ url, options })
      return url === '/api/security/csrf-token'
        ? { ok: true, json: async () => ({ csrfToken: 'test-csrf' }) }
        : { ok: true, status: 201, json: async () => ({ success: true, track: { source: 'local', title: '海岸' } }) }
    }
    const file = new File(['audio'], '海岸.mp3', { type: 'audio/mpeg' })
    const track = await uploadMusicFile(file, { title: '海岸', artist: '测试歌手', album: '夜航' }, fetcher)
    assert.equal(track.title, '海岸')
    assert.equal(calls[0].url, '/api/security/csrf-token')
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.equal(calls[1].url, '/api/local/music')
    assert.equal(calls[1].options.method, 'POST')
    assert.equal(calls[1].options.credentials, 'same-origin')
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'test-csrf')
    assert.equal(calls[1].options.headers['Content-Type'], undefined)
    assert.equal(calls[1].options.body.get('file').name, '海岸.mp3')
    assert.equal(calls[1].options.body.get('title'), '海岸')
    assert.equal(calls[1].options.body.get('artist'), '测试歌手')
    assert.equal(calls[1].options.body.get('album'), '夜航')
    assert.equal(calls[1].options.body.get('role'), null)
  })

  it('上传失败只显示安全提示，不透传服务器内部错误', async () => {
    const { uploadMusicFile } = await import(pathToFileURL(frontendFile('upload-client.ts')).href)
    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    const failingFetch = async (url) => url === '/api/security/csrf-token'
      ? { ok: true, json: async () => ({ csrfToken: 'test-csrf' }) }
      : { ok: false, status: 500, json: async () => ({ message: '/secret/storage/music/test.mp3' }) }
    await assert.rejects(uploadMusicFile(file, { title: '测试', artist: '歌手' }, failingFetch), (error) => {
      assert.equal(error.message, '上传暂时失败，请稍后重试。')
      assert.doesNotMatch(error.message, /storage|secret/)
      return true
    })
  })

  it('没有 CSRF Token 时不发送音频，超限时显示明确但安全的提示', async () => {
    const { uploadMusicFile } = await import(pathToFileURL(frontendFile('upload-client.ts')).href)
    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' })
    let calls = 0
    await assert.rejects(uploadMusicFile(file, { title: '测试', artist: '歌手' }, async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({}) }
    }), /安全校验失败/)
    assert.equal(calls, 1)

    await assert.rejects(uploadMusicFile(file, { title: '测试', artist: '歌手' }, async (url) => url === '/api/security/csrf-token'
      ? { ok: true, json: async () => ({ csrfToken: 'csrf' }) }
      : { ok: false, status: 413, json: async () => ({ message: '内部文件路径' }) }), /超过服务器允许的大小/)
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
