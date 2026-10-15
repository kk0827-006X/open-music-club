export type ThemePreference = 'light' | 'dark' | 'system'
export type ThemeState = { preference: ThemePreference; resolved: 'light' | 'dark'; persisted: boolean }

// 唯一主题控制器是 head 中的 theme-init.js；页面只通过这个窄接口读写外观。
export function getThemeState(): ThemeState {
  const data = typeof document === 'undefined' ? undefined : document.documentElement?.dataset
  const preference = data?.themePreference
  return { preference: preference === 'dark' || preference === 'system' ? preference : 'light',
    resolved: data?.theme === 'dark' ? 'dark' : 'light', persisted: data?.themePersisted !== 'false' }
}
export function setThemePreference(preference: ThemePreference) {
  window.dispatchEvent(new window.CustomEvent('omc:theme-preference', { detail: preference }))
}
export function subscribeTheme(listener: (state: ThemeState) => void) {
  const changed = () => listener(getThemeState())
  window.addEventListener('omc:themechange', changed)
  return () => window.removeEventListener('omc:themechange', changed)
}
export function themeColor(token: `--${string}`) {
  return typeof document === 'undefined' ? '' : window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
}
