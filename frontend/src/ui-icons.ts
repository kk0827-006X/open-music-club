// 图形只定义一次；所有页面共享图标标记，动画统一由 CSS 控制。
const glyphs = {
  play: '▶', plus: '＋', close: '×',
  left: '←', right: '→', up: '↑', down: '↓', open: '↗',
} as const

const eye = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
const paths = {
  library: '<path d="M3.5 6.5h6l1.7 2H20.5v9.5H3.5z"/><path d="M3.5 6.5v-2h6l1.7 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 5 5"/>',
  upload: '<path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M4 14v6h16v-6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20v-1.5a7.5 7.5 0 0 1 15 0V20z"/>',
  queue: '<path d="M4 6h11M4 12h7M4 18h11"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  heart: '<path d="M20.8 4.7a5.2 5.2 0 0 0-7.4 0L12 6.1l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21l8.8-8.9a5.2 5.2 0 0 0 0-7.4Z"/>',
  previous: '<path d="M6 5v14M18 6l-9 6 9 6z"/>',
  next: '<path d="M18 5v14M6 6l9 6-9 6z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6"/>',
  eye,
  eyeOff: `${eye}<path d="m3 3 18 18"/>`,
} as const

export type UiIconName = keyof typeof glyphs | keyof typeof paths

export function uiIcon(name: UiIconName, filled = false): string {
  if (name in glyphs) return `<span class="ui-icon" data-ui-icon="${name}" aria-hidden="true">${glyphs[name as keyof typeof glyphs]}</span>`
  return `<svg class="ui-icon" data-ui-icon="${name}" data-filled="${filled}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name as keyof typeof paths]}</svg>`
}

// 静态图标在模块加载时生成，列表重绘无需反复拼接 SVG。
export const uiIcons = Object.freeze(Object.fromEntries(
  [...Object.keys(glyphs), ...Object.keys(paths)].map((name) => [name, uiIcon(name as UiIconName)]),
) as Record<UiIconName, string>)
