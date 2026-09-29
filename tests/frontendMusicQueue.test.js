const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../frontend/src/music-queue.ts')).href
const song = (key) => ({ key, kind: 'song', title: key, source: key.split(':')[0] })

describe('全站播放器队列', () => {
  it('用来源加 ID 区分歌曲，重复加入不会产生副本', async () => {
    const { MusicQueue } = await import(moduleUrl)
    const queue = new MusicQueue()
    queue.add(song('local:1'))
    queue.add(song('netease:1'))
    queue.add(song('local:1'))
    assert.deepEqual(queue.items.map((item) => item.key), ['local:1', 'netease:1'])
  })

  it('支持上下移动、移除、清空及下一首', async () => {
    const { MusicQueue } = await import(moduleUrl)
    const queue = new MusicQueue()
    queue.add(song('local:1'))
    queue.add(song('local:2'))
    queue.add(song('local:3'))
    queue.move('local:3', -1)
    assert.deepEqual(queue.items.map((item) => item.key), ['local:1', 'local:3', 'local:2'])
    assert.equal(queue.next('local:1').key, 'local:3')
    queue.remove('local:3')
    assert.deepEqual(queue.items.map((item) => item.key), ['local:1', 'local:2'])
    queue.clear()
    assert.equal(queue.items.length, 0)
  })
})
