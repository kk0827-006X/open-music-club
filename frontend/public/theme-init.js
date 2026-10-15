// 同源阻塞脚本在页面解析前执行；整份文档共用主题，不属于登录会话或播放器。
(() => {
  const root = document.documentElement
  if (root.dataset.themeInitialized === 'true') return
  root.dataset.themeInitialized = 'true'
  const key = 'omc.theme'
  const valid = value => value === 'light' || value === 'dark' || value === 'system'
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let preference = 'light'
  try {
    const saved = window.localStorage.getItem(key)
    if (valid(saved)) preference = saved
  } catch { /* 隐私模式禁用存储时仍可使用当前页面。 */ }
  const apply = () => {
    root.dataset.themePreference = preference
    root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
    const color = window.getComputedStyle(root).getPropertyValue('--paper').trim()
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta && color) meta.setAttribute('content', color)
    window.dispatchEvent(new CustomEvent('omc:themechange'))
  }
  window.addEventListener('omc:theme-preference', event => {
    if (!valid(event.detail)) return
    preference = event.detail
    try { window.localStorage.setItem(key, preference); root.dataset.themePersisted = 'true' }
    catch { root.dataset.themePersisted = 'false' }
    apply()
  })
  const systemChanged = () => { if (preference === 'system') apply() }
  if (media.addEventListener) media.addEventListener('change', systemChanged)
  else media.addListener(systemChanged)
  window.addEventListener('storage', event => {
    // 忽略 sessionStorage、其他键和非法内容；清空偏好恢复网站原来的浅色。
    try { if (event.storageArea && event.storageArea !== window.localStorage) return } catch { return }
    if (event.key !== key && event.key !== null) return
    if (event.newValue !== null && !valid(event.newValue)) return
    preference = event.newValue ?? 'light'
    root.dataset.themePersisted = 'true'
    apply()
  })
  apply()
})()
