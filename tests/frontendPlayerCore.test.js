const assert = require('node:assert/strict')
const { it } = require('node:test')
const song = (id, source = 'local') => ({ key: `${source}:${id}`, kind: 'song', source, sourceId: String(id), title: String(id) })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
class FakeAudio extends EventTarget {
  paused = true; currentTime = 0; duration = NaN; volume = 1; src = ''; preload = ''
  plays = 0; loads = 0
  play() { this.paused = false; this.plays++; this.dispatchEvent(new Event('play')); return Promise.resolve() }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
  removeAttribute(name) { if (name === 'src') this.src = '' }
  load() { this.loads++ }
}
async function setup(resolveUrl = async track => `/${track.source}/${track.sourceId}`) {
  const { createPlayerController } = await import('../frontend/src/features/player/player-core.ts')
  const { MusicQueue } = await import('../frontend/src/music-queue.ts')
  const audio = new FakeAudio(), queue = new MusicQueue()
  let created = 0
  const player = createPlayerController({ queue, resolveUrl, createAudio: () => { created++; return audio } })
  return { player, queue, audio, created: () => created }
}
it('跨来源播放共用一个音频实例，音量、进度、暂停及上下曲目兼容', async () => {
  const { player, queue, audio, created } = await setup()
  queue.restore([song(1), song(1, 'netease')])
  assert.equal(audio.preload, 'none'); assert.equal(audio.volume, .62)
  await player.play(queue.items[0]); await player.next()
  assert.equal(audio.src, '/netease/1'); assert.equal(created(), 1)
  await player.previous(); assert.equal(player.get().track.key, 'local:1')
  await player.toggle(); assert.equal(player.get().paused, true)
  await player.toggle(); assert.equal(player.get().paused, false)
  player.setVolume(.3); assert.equal(player.get().volume, .3)
  player.seek(.5); assert.equal(audio.currentTime, 0)
  audio.duration = 100; audio.dispatchEvent(new Event('loadedmetadata'))
  player.seek(.5); assert.equal(audio.currentTime, 50)
  assert.equal(player.get().currentTime, 50)
  audio.dispatchEvent(new Event('ended'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(player.get().track.key, 'netease:1')
  player.destroy(); player.destroy(); assert.equal(audio.loads, 1)
})
it('较慢的旧播放地址即使忽略取消信号也不会覆盖当前曲目', async () => {
  const old = deferred(), signals = []
  const { player, audio } = await setup((track, signal) => { signals.push(signal); return track.sourceId === '1' ? old.promise : Promise.resolve('/new') })
  const pending = player.play(song(1))
  await player.play(song(2)); old.resolve('/old'); await pending
  assert.equal(signals[0].aborted, true)
  assert.equal(audio.src, '/new'); assert.equal(audio.plays, 1)
  player.destroy()
})
it('清空和销毁取消异步播放、移除监听；订阅可以独立取消', async () => {
  const pending = deferred()
  const { player, audio } = await setup(() => pending.promise)
  let notified = 0
  const off = player.subscribe(() => notified++)
  player.setVolume(.4); off(); const count = notified
  const playing = player.play(song(1)); player.clear(); player.destroy()
  pending.resolve('/late'); await playing
  audio.dispatchEvent(new Event('timeupdate'))
  assert.equal(audio.plays, 0); assert.equal(audio.src, '')
  assert.equal(notified, count)
  await player.play(song(2)); assert.equal(audio.plays, 0)
})
it('音频错误保持原安全提示，上游失败不覆盖上一首', async () => {
  let fail = false
  const { player, audio } = await setup(async () => { if (fail) throw new Error('歌曲暂不可播放'); return '/ok' })
  await player.play(song(1)); fail = true
  await assert.rejects(player.play(song(2)), /暂不可播放/)
  assert.equal(player.get().track.key, 'local:1')
  audio.dispatchEvent(new Event('error'))
  assert.equal(player.get().error, '音频加载失败，请重新选择歌曲。')
  player.destroy()
})
