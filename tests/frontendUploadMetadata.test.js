const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { Blob: NativeBlob, File: NativeFile } = require('node:buffer')
const { withReactHarness } = require('./helpers/reactHarness')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../frontend/src/features/upload/metadata.ts')).href

function frame(id, value) {
  const data = Buffer.from(value)
  const header = Buffer.alloc(10)
  header.write(id, 0, 'ascii')
  header.writeUInt32BE(data.length, 4)
  return Buffer.concat([header, data])
}

function taggedAudio(title = '海岸') {
  const picture = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  const frames = Buffer.concat([
    frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from(title)])),
    frame('TPE1', Buffer.concat([Buffer.from([3]), Buffer.from('测试歌手')])),
    frame('TALB', Buffer.concat([Buffer.from([3]), Buffer.from('夜航')])),
    frame('APIC', Buffer.concat([
      Buffer.from([3]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), picture,
    ])),
  ])
  const header = Buffer.from([
    0x49, 0x44, 0x33, 3, 0, 0,
    (frames.length >>> 21) & 0x7f,
    (frames.length >>> 14) & 0x7f,
    (frames.length >>> 7) & 0x7f,
    frames.length & 0x7f,
  ])
  const audioFrame = Buffer.alloc(417)
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(audioFrame)
  return new NativeBlob([header, frames, audioFrame], { type: 'audio/mpeg' })
}

describe('上传页本地音频标签识别', () => {
  it('真实上传页读取完成前禁止提交，更换文件后丢弃旧标签和封面', async () => {
    const oldFile = new NativeFile([await taggedAudio('旧标题').arrayBuffer()], 'old.mp3', { type: 'audio/mpeg' })
    const nextFile = new NativeFile([await taggedAudio('新标题').arrayBuffer()], 'next.mp3', { type: 'audio/mpeg' })
    let release, started = false, requests = 0
    const gate = new Promise(resolve => { release = resolve })
    const slice = oldFile.slice.bind(oldFile)
    // 只延迟文件字节读取，标签仍由生产 music-metadata 解析，不伪造识别结果。
    oldFile.slice = (...args) => {
      const part = slice(...args)
      return { arrayBuffer: async () => { started = true; await gate; return part.arrayBuffer() } }
    }
    await withReactHarness(async h => {
      const { UploadPage } = await import('../frontend/src/features/upload/UploadPage.tsx')
      const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
      const covers = [], released = []
      URL.createObjectURL = blob => { covers.push(blob.type); return `blob:test-cover-${covers.length}` }
      URL.revokeObjectURL = url => released.push(url)
      try {
        await h.render(h.React.createElement(UploadPage, { active: true }))
        const choose = async file => {
          const input = h.require('[data-upload-file]')
          Object.defineProperty(input, 'files', { configurable: true, value: [file] })
          await h.React.act(async () => input.dispatchEvent(new h.window.Event('change', { bubbles: true })))
        }
        await choose(oldFile)
        await h.until(() => started, '必须实际开始旧文件的标签读取')
        assert.equal(h.require('[data-upload-submit]').disabled, true)
        await h.submit('[data-upload-form]')
        assert.equal(requests, 0, '标签读取未完成不能发送上传或 CSRF 请求')
        await choose(nextFile)
        await h.until(() => !h.require('[data-upload-submit]').disabled, '新文件读取完毕后才开放提交')
        assert.equal(h.require('[data-upload-title]').value, '新标题')
        assert.equal(h.require('[data-upload-artist]').value, '测试歌手')
        assert.equal(h.require('[data-upload-album]').value, '夜航')
        assert.equal(h.require('[data-upload-cover]').getAttribute('src'), 'blob:test-cover-1')
        await h.React.act(async () => release())
        await h.flush(20)
        assert.equal(h.require('[data-upload-title]').value, '新标题')
        assert.equal(h.require('[data-upload-filename]').textContent, 'next.mp3')
        assert.equal(h.require('[data-upload-cover]').getAttribute('src'), 'blob:test-cover-1')
        assert.deepEqual(covers, ['image/jpeg'], '旧识别结果不能覆盖新封面或创建多余 ObjectURL')
        await h.unmount()
        assert.deepEqual(released, ['blob:test-cover-1'], '卸载必须释放当前封面')
      } finally {
        release()
        await h.unmount()
        await h.flush(20)
        URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
      }
    }, { fetch: async () => { requests++; throw new Error('标签预览不应联网') } })
  })

  it('选中文件后可读取标题、歌手、专辑和内嵌封面', async () => {
    const { readUploadMetadata } = await import(moduleUrl)
    const result = await readUploadMetadata(taggedAudio())
    assert.equal(result.title, '海岸')
    assert.equal(result.artist, '测试歌手')
    assert.equal(result.album, '夜航')
    assert.equal(result.cover.type, 'image/jpeg')
    assert.deepEqual(Buffer.from(await result.cover.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('无标签或坏文件不能伪造歌曲资料', async () => {
    const { readUploadMetadata } = await import(moduleUrl)
    const result = await readUploadMetadata(new Blob([Buffer.alloc(44)]))
    assert.equal(result.title, '')
    assert.equal(result.artist, '')
    assert.equal(result.album, '')
    assert.equal(result.cover, null)
  })
})
