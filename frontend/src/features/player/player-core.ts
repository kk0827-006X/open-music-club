import { createState } from '../../shared/state.ts'
import type { MusicItem } from '../../shared/music.ts'
import type { MusicQueue } from "../queue/model.ts"

export type PlayerState = Readonly<{
  track: MusicItem | null
  paused: boolean
  currentTime: number
  duration: number
  volume: number
  error: string | null
}>
export type PlayerController = ReturnType<typeof createPlayerController>

// 认证后的应用会话创建一次；页面只使用动作和状态，不持有音频元素。
export function createPlayerController(options: {
  queue: MusicQueue
  resolveUrl: (track: MusicItem, signal: AbortSignal) => Promise<string>
  createAudio?: () => HTMLAudioElement
}) {
  const audio = options.createAudio?.() ?? new Audio()
  audio.preload = 'none'
  audio.volume = .62
  let track: MusicItem | null = null, request = 0, disposed = false
  let pending: AbortController | null = null
  let error: string | null = null
  const snapshot = (): PlayerState => ({ track, paused: audio.paused, currentTime: audio.currentTime,
    duration: audio.duration, volume: audio.volume, error })
  const state = createState(snapshot())
  const update = () => { if (!disposed) state.set(snapshot()) }
  const cancel = () => { request++; pending?.abort(); pending = null }
  async function play(next: MusicItem) {
    if (disposed) return
    cancel()
    const current = request, controller = new AbortController()
    pending = controller
    const url = await options.resolveUrl(next, controller.signal)
    if (disposed || current !== request) return
    audio.pause()
    audio.src = url
    track = next; error = null
    update()
    await audio.play()
  }
  const next = async () => { const item = track && options.queue.next(track.key); if (item) await play(item) }
  const previous = async () => { const item = track && options.queue.previous(track.key); if (item) await play(item) }
  const ended = () => { update(); void next().catch(() => undefined) }
  const failed = () => { audio.pause(); error = '音频加载失败，请重新选择歌曲。'; update() }
  const events = ['timeupdate', 'loadedmetadata', 'play', 'pause', 'volumechange']
  events.forEach(event => audio.addEventListener(event, update))
  audio.addEventListener('ended', ended); audio.addEventListener('error', failed)
  return {
    get: state.get, subscribe: state.subscribe, play, next, previous,
    async toggle() {
      if (disposed || !track) return
      if (audio.paused) await audio.play()
      else audio.pause()
    },
    setVolume(volume: number) { if (!disposed) { audio.volume = volume; update() } },
    seek(fraction: number) {
      if (!disposed && track && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, Math.max(0, fraction * audio.duration)); update()
      }
    },
    clear() {
      if (disposed) return
      cancel(); audio.pause(); audio.removeAttribute('src'); track = null; error = null; update()
    },
    destroy() {
      if (disposed) return
      disposed = true; cancel()
      events.forEach(event => audio.removeEventListener(event, update))
      audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed)
      state.destroy(); audio.pause(); audio.removeAttribute('src'); audio.load()
    },
  }
}
