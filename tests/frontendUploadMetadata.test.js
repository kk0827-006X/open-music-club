const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../frontend/src/upload-metadata.ts')).href

function frame(id, value) {
  const data = Buffer.from(value)
  const header = Buffer.alloc(10)
  header.write(id, 0, 'ascii')
  header.writeUInt32BE(data.length, 4)
  return Buffer.concat([header, data])
}

function taggedAudio() {
  const picture = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  const frames = Buffer.concat([
    frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('海岸')])),
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
  return new Blob([header, frames, audioFrame], { type: 'audio/mpeg' })
}

describe('上传页本地音频标签识别', () => {
  it('上传页面在提交前读取所选文件，且丢弃过期的识别结果', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/upload-page.ts'), 'utf8')
    assert.match(source, /readUploadMetadata\(file\)/)
    assert.match(source, /currentRequestId !== metadataRequestId/)
    assert.match(source, /isSubmitting \|\| isReadingMetadata/)
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
