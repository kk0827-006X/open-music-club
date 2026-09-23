import { openMusicMark } from './entry-page.ts'
import { bootMotion } from './rhine-motion/boot-motion.ts'

const SOURCE_SCAN_START_SECONDS = 14.48
const SOURCE_SEQUENCE_DURATION_MS = 7_440
const FINAL_WELCOME_FRAME_MS = 6_650

export function sampleAuthorizedSequence(elapsedMs: number) {
  const elapsed = Math.max(0, elapsedMs)
  return {
    ...bootMotion(SOURCE_SCAN_START_SECONDS + elapsed / 1000),
    complete: elapsed >= SOURCE_SEQUENCE_DURATION_MS,
  }
}

function arc(radius: number, start: number, sweep: number, x = 960, y = 540) {
  const point = (angle: number) => `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`
  if (sweep >= Math.PI * 1.999) {
    return `M${point(start)}A${radius},${radius} 0 1 1 ${point(start + Math.PI)}A${radius},${radius} 0 1 1 ${point(start + Math.PI * 2)}`
  }
  return `M${point(start)}A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(start + sweep)}`
}

function createSequenceMarkup(role: 'admin' | 'user') {
  const satellites = Array.from({ length: 6 }, () => '<circle class="sequence-satellite" />').join('')
  return `
    <main class="authorized-viewport" aria-live="polite">
      <div class="authorized-stage" data-authorized-stage>
        <div class="sequence-background"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg></div>
        <header class="sequence-brand"><h1>OPEN MUSIC CLUB</h1><div>MUSIC ARCHIVE</div><p>ACCESS SYSTEM</p></header>
        <p class="sequence-enter">ENTER SYSTEM&nbsp;&nbsp;↗</p>
        <section class="sequence-scan">
          <svg viewBox="0 0 1920 1080" aria-hidden="true">
            <g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round" data-scan-group>
              <path/><path stroke="#fff"/><path/><path/><path/><path/>
              <circle class="sequence-orbit-dot" r="8" fill="#ed821b" stroke="none"/>
              <circle class="sequence-orbit-dot" r="8" fill="#ed821b" stroke="none"/>
              ${satellites}
              <circle class="sequence-core" cx="959.5" cy="539.5" r="5" fill="#080a08" stroke="none"/>
              <circle class="sequence-cap sequence-cap-dark" fill="#080a08" stroke="none"/>
              <circle class="sequence-cap sequence-cap-light" fill="#fff" stroke="none"/>
            </g>
          </svg>
          <span>PERMISSION AUTHORIZED</span>
        </section>
        <section class="sequence-welcome">
          <div class="sequence-welcome-panel"></div>
          <div class="sequence-welcome-heading">WELCOME TO</div>
          <div class="sequence-company"><strong>OPEN MUSIC CLUB</strong><strong class="sequence-highlight" aria-hidden="true">OPEN MUSIC CLUB</strong></div>
          <div class="sequence-database">COMMUNITY MUSIC ARCHIVE</div>
          <div class="sequence-logo">${openMusicMark}</div>
        </section>
        <div class="sequence-powered">POWERED BY <b>OPEN MUSIC CLUB</b><i></i></div>
        <p class="sequence-session">${role === 'admin' ? 'ADMIN SESSION VERIFIED' : 'MEMBER SESSION VERIFIED'}</p>
      </div>
    </main>`
}

function renderScan(stage: HTMLElement, state: ReturnType<typeof sampleAuthorizedSequence>) {
  const paths = [...stage.querySelectorAll<SVGPathElement>('.sequence-scan path')]
  const group = stage.querySelector<SVGGElement>('[data-scan-group]')
  const { scan } = state
  if (!group || paths.length < 6) return
  group.setAttribute('transform', `translate(960 540) scale(${state.ringScale}) translate(-960 -540)`)
  group.style.opacity = String(state.ringOpacity)
  group.style.filter = `blur(${state.ringBlur}px)`
  paths[0].setAttribute('d', arc(scan.radius, scan.outerStart, scan.outerSweep))
  paths[0].setAttribute('stroke-width', '2.4')
  paths[1].setAttribute('d', arc(scan.whiteRadius, scan.whiteStart, scan.whiteSweep))
  paths[1].setAttribute('stroke-width', '4')
  paths[2].setAttribute('d', arc(scan.innerRadius, scan.innerStart, scan.innerSweep))
  paths[3].setAttribute('d', arc(scan.innerRadius, scan.innerStart + Math.PI, scan.innerSweep))
  state.scanOrbit.sides.forEach((side, index) => {
    paths[index + 4].setAttribute('d', arc(side.radius, side.start, side.sweep, side.x, side.y))
    paths[index + 4].style.opacity = state.scanOrbit.sideVisible ? '1' : '0'
  })
  const satellites = [...stage.querySelectorAll<SVGCircleElement>('.sequence-satellite')]
  state.scanOrbit.satellites.forEach((point, index) => {
    satellites[index].setAttribute('cx', String(point.x))
    satellites[index].setAttribute('cy', String(point.y))
    satellites[index].setAttribute('r', String(point.radius))
  })
  const core = stage.querySelector<SVGCircleElement>('.sequence-core')
  if (core) {
    core.style.opacity = state.ornament ? '1' : '0'
    core.setAttribute('r', String(state.coreRadius))
  }
  stage.querySelectorAll<SVGCircleElement>('.sequence-orbit-dot').forEach((dot, index) => {
    dot.setAttribute('cx', String(960 + Math.cos(scan.orbit + index * Math.PI) * scan.orbitRadius))
    dot.setAttribute('cy', String(540 + Math.sin(scan.orbit + index * Math.PI) * scan.orbitRadius))
    dot.setAttribute('r', String(scan.dotRadius))
  })
  const caps = [...stage.querySelectorAll<SVGCircleElement>('.sequence-cap')]
  const capPoints = [
    { angle: scan.outerStart + scan.outerSweep, radius: scan.radius, size: scan.blackCap },
    { angle: scan.whiteStart, radius: scan.whiteRadius, size: scan.whiteCap },
  ]
  caps.forEach((cap, index) => {
    const point = capPoints[index]
    cap.setAttribute('cx', String(960 + Math.cos(point.angle) * point.radius))
    cap.setAttribute('cy', String(540 + Math.sin(point.angle) * point.radius))
    cap.setAttribute('r', String(point.size))
  })
  const permission = stage.querySelector<HTMLElement>('.sequence-scan > span')
  if (permission) {
    permission.style.opacity = String(state.permissionOpacity)
    permission.style.letterSpacing = `${state.scanTracking}px`
    permission.style.fontSize = `${state.scanFont}px`
  }
}

function renderFrame(stage: HTMLElement, elapsedMs: number) {
  const state = sampleAuthorizedSequence(Math.min(elapsedMs, FINAL_WELCOME_FRAME_MS))
  const scan = stage.querySelector<HTMLElement>('.sequence-scan')
  if (scan) scan.style.opacity = String(Number(state.scanVisible))
  if (state.scanVisible) renderScan(stage, state)

  const welcome = stage.querySelector<HTMLElement>('.sequence-welcome')
  if (welcome) {
    welcome.style.opacity = String(state.welcomeVisible ? state.welcomeOpacity : 0)
    welcome.style.transform = `scale(${state.welcomeScale})`
    welcome.style.filter = `blur(${state.exitBlur}px)`
  }
  const panel = stage.querySelector<HTMLElement>('.sequence-welcome-panel')
  if (panel) panel.style.opacity = String(state.welcomePanel)
  const company = stage.querySelector<HTMLElement>('.sequence-company')
  if (company) company.style.opacity = String(state.companyVisible ? 1 : 0)
  const highlight = stage.querySelector<HTMLElement>('.sequence-highlight')
  if (highlight) highlight.style.clipPath = `inset(0 ${100 * (1 - state.highlight)}% 0 0)`
  const database = stage.querySelector<HTMLElement>('.sequence-database')
  if (database) database.style.opacity = String(state.databaseOpacity)
  const logo = stage.querySelector<HTMLElement>('.sequence-logo')
  if (logo) logo.style.opacity = String(state.welcomeLogo)
  return sampleAuthorizedSequence(elapsedMs)
}

export function mountAuthorizedSequence(
  root: HTMLElement,
  role: 'admin' | 'user',
  onComplete?: () => void,
) {
  root.innerHTML = createSequenceMarkup(role)
  const stage = root.querySelector<HTMLElement>('[data-authorized-stage]')
  if (!stage) return () => undefined
  const fit = () => {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`
  }
  fit()
  window.addEventListener('resize', fit)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const startedAt = performance.now()
  let frame = 0
  let finished = false
  const animate = (now: number) => {
    const elapsed = reduced ? FINAL_WELCOME_FRAME_MS : now - startedAt
    const state = renderFrame(stage, elapsed)
    if (!reduced && !state.complete) frame = window.requestAnimationFrame(animate)
    else if (!finished) {
      finished = true
      window.setTimeout(() => onComplete?.(), reduced ? 500 : 650)
    }
  }
  frame = window.requestAnimationFrame(animate)
  return () => {
    window.cancelAnimationFrame(frame)
    window.removeEventListener('resize', fit)
  }
}
