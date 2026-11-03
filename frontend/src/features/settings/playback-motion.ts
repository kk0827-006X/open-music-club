const KEY = 'omc:playback-motion'

// 独立浏览器偏好，不复用旧占位开关，也不关联账号或音频播放状态。
export function readPlaybackMotion() {
  try { return window.localStorage.getItem(KEY) !== 'false' } catch { return true }
}
export function savePlaybackMotion(enabled: boolean) {
  try { window.localStorage.setItem(KEY, String(enabled)) } catch { /* 存储不可用时仍在当前会话生效。 */ }
}
