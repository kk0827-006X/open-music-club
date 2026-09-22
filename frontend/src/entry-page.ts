const openMusicMark = `
  <svg viewBox="0 0 310 185" role="img" aria-label="Open Music Club">
    <path d="M156 75C127 48 103 15 70 15C37 15 15 39 15 70S38 128 70 128C103 128 127 96 176 52M155 75C182 99 208 128 240 128C273 128 295 105 295 73S273 15 240 15C221 15 207 23 192 38" fill="none" stroke="currentColor" stroke-width="26"/>
    <path d="M44 70h50M69 45v50M219 70h44" fill="none" stroke="currentColor" stroke-width="15"/>
    <text x="155" y="174" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" letter-spacing="12">OPEN·MUSIC</text>
  </svg>`

export function createEntryMarkup() {
  return `
    <main class="entry-gate" aria-labelledby="entry-title">
      <div class="entry-mark">${openMusicMark}</div>
      <h1 id="entry-title" class="sr-only">OPEN MUSIC CLUB</h1>
      <p>OPEN MUSIC CLUB / READY</p>
      <i aria-hidden="true"></i>
      <button type="button" data-entry-start>点击进入&nbsp;&nbsp;→</button>
      <small>轻触屏幕或按 Enter 开始</small>
    </main>`
}

export function mountEntryPage(root: HTMLElement, onEnter: () => void) {
  root.innerHTML = createEntryMarkup()
  const page = root.querySelector<HTMLElement>('.entry-gate')
  const button = root.querySelector<HTMLButtonElement>('[data-entry-start]')
  let entered = false
  const enter = () => {
    if (entered) return
    entered = true
    page?.classList.add('is-leaving')
    window.setTimeout(onEnter, 520)
  }
  button?.addEventListener('click', enter)
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') enter()
  }
  window.addEventListener('keydown', onKeydown)
  button?.focus({ preventScroll: true })
  return () => window.removeEventListener('keydown', onKeydown)
}

export { openMusicMark }
