import type { PlayerController, PlayerState } from './player-core.ts'

// 旧 SSR 预览入口的无副作用状态，不创建 Audio，也不发起任何请求。
export function createPreviewPlayer(volume = .62): PlayerController {
  const state: PlayerState = { track: null, paused: true, currentTime: 0, duration: NaN, volume, error: null }
  const noop = () => undefined
  const asyncNoop = async () => undefined
  return { get: () => state, subscribe: () => noop, play: asyncNoop, next: asyncNoop, previous: asyncNoop,
    toggle: asyncNoop, setVolume: noop, seek: noop, clear: noop, destroy: noop }
}
