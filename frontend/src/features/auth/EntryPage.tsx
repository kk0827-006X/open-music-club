import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../shared/react/ui.tsx'

export function OpenMusicMark() {
  return <svg viewBox="0 0 310 185" role="img" aria-label="Open Music Club">
    <path d="M156 75C127 48 103 15 70 15C37 15 15 39 15 70S38 128 70 128C103 128 127 96 176 52M155 75C182 99 208 128 240 128C273 128 295 105 295 73S273 15 240 15C221 15 207 23 192 38" fill="none" stroke="currentColor" strokeWidth="26" />
    <path d="M44 70h50M69 45v50M219 70h44" fill="none" stroke="currentColor" strokeWidth="15" />
    <text x="155" y="174" textAnchor="middle" fill="var(--mark-text)" fontFamily="sans-serif" fontSize="13" fontWeight="700" letterSpacing="12">OPEN·MUSIC</text>
  </svg>
}

export function EntryPage({ onEnter }: { onEnter?: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const entered = useRef(false)
  const timer = useRef(0)
  const button = useRef<HTMLButtonElement>(null)
  const callback = useRef(onEnter)
  callback.current = onEnter
  const enter = () => {
    if (entered.current) return
    entered.current = true
    setLeaving(true)
    timer.current = window.setTimeout(() => callback.current?.(), 520)
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter') enter() }
    window.addEventListener('keydown', keydown)
    button.current?.focus({ preventScroll: true })
    return () => { window.clearTimeout(timer.current); window.removeEventListener('keydown', keydown) }
  }, [])
  return <main className={`entry-gate${leaving ? ' is-leaving' : ''}`} aria-labelledby="entry-title">
    <div className="entry-mark"><OpenMusicMark /></div>
    <h1 id="entry-title" className="sr-only">OPEN MUSIC CLUB</h1>
    <p>OPEN MUSIC CLUB / READY</p><i aria-hidden="true" />
    <button ref={button} type="button" data-entry-start onClick={enter}>点击进入&nbsp;&nbsp;<Icon name="right" /></button>
    <small>轻触屏幕或按 Enter 开始</small>
  </main>
}
