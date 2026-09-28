import { demoAlbums, type DemoAlbum } from './album-data.ts'
import { mountSearchPage } from './search-page.ts'
import { resolvePlaybackUrl, type SearchItem } from './music-search.ts'
import { archiveColumns, columnFiles, fileLocation, records } from './rhine/data.ts'
import type { ArchiveScene } from './rhine/scene.ts'

const icon = (content: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`
const icons = {
  library: icon('<path d="M3.5 6.5h6l1.7 2H20.5v9.5H3.5z"/><path d="M3.5 6.5v-2h6l1.7 2"/>'),
  search: icon('<circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 5 5"/>'),
  upload: icon('<path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5M4 14v6h16v-6"/>'),
  queue: icon('<path d="M4 6h11M4 12h7M4 18h11"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>'),
  heart: icon('<path d="M20.8 4.7a5.2 5.2 0 0 0-7.4 0L12 6.1l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21l8.8-8.9a5.2 5.2 0 0 0 0-7.4Z"/>'),
  previous: icon('<path d="M6 5v14M18 6l-9 6 9 6z"/>'),
  next: icon('<path d="M18 5v14M6 6l9 6-9 6z"/>'),
  pause: icon('<path d="M8 5v14M16 5v14"/>'),
  play: icon('<path d="m8 5 11 7-11 7z"/>'),
  volume: icon('<path d="M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6"/>'),
}

function archiveNavigation() {
  return `<nav class="archive-nav" data-archive-navigation aria-label="音乐功能预览">
    <button type="button" data-nav="library" aria-current="page">${icons.library}<span>音乐库</span></button>
    <button type="button" data-nav="search">${icons.search}<span>搜索</span></button>
    <button type="button" data-nav="upload">${icons.upload}<span>上传音乐</span></button>
    <button type="button" data-nav="queue">${icons.queue}<span>队列</span><small>03</small></button>
    <i aria-hidden="true"></i>
    <button type="button" data-nav="settings">${icons.settings}<span>设置</span></button>
  </nav>`
}

function durationOf(album: DemoAlbum) {
  const seconds = album.tracks.reduce((total, track) => {
    const [minutes, remainder] = track.duration.split(':').map(Number)
    return total + minutes * 60 + remainder
  }, 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function playerMarkup(album: DemoAlbum) {
  const track = album.tracks[0]
  return `<footer class="global-player" data-global-player aria-label="全站播放器">
    <section class="player-track" data-player-track>
      <img src="${album.coverUrl}" alt="${album.title} 封面缩略图" />
      <div><strong>${track.title}</strong><span>${album.artist}&nbsp;&nbsp;/&nbsp;&nbsp;${album.title}</span></div>
      <b><i></i>LOCAL</b><button type="button" aria-label="收藏歌曲" aria-disabled="true">${icons.heart}</button>
    </section>
    <section class="player-timeline" data-player-progress><time>0:00</time><button type="button" data-player-progress-bar aria-label="播放进度" disabled><i></i><b></b></button><time>${track.duration.replace(/^0/, '')}</time></section>
    <section class="player-controls" data-player-controls>
      <button type="button" aria-label="上一首" aria-disabled="true">${icons.previous}</button>
      <button class="player-main-control" type="button" data-player-toggle aria-label="播放" disabled>${icons.play}</button>
      <button type="button" aria-label="下一首" aria-disabled="true">${icons.next}</button>
    </section>
    <section class="player-volume" data-player-volume>${icons.volume}<div><i></i></div></section>
    <section class="player-queue-summary">${icons.queue}<span>03</span></section>
    <p>GOOD MUSIC<br />FOR A BRIGHTER TOMORROW.</p>
  </footer>`
}

function albumInformation(album: DemoAlbum, index: number) {
  return `<aside class="archive-selection-copy" data-album-information aria-live="polite">
    <p>ALBUM ${String(index + 1).padStart(3, '0')}</p><h2>${album.title}</h2><h3>${album.artist}</h3><span>${album.artist}</span>
    <dl>
      <div><dt>RELEASE / 发行年份</dt><dd>${album.year}</dd></div><div><dt>ARTIST / 艺术家</dt><dd>${album.artist}</dd></div>
      <div><dt>GENRE / 流派</dt><dd>${album.genre}</dd></div><div><dt>SOURCE / 来源</dt><dd><b><i></i>LOCAL</b></dd></div>
      <div><dt>TRACKS / 曲目数量</dt><dd>${album.tracks.length} 首</dd></div><div><dt>FORMAT / 文件格式</dt><dd>FLAC / 24bit</dd></div>
      <div><dt>DURATION / 总时长</dt><dd>${durationOf(album)}</dd></div><div><dt>LABEL / 厂牌</dt><dd>社区独立发行</dd></div>
    </dl><button type="button" data-open-selected>打开专辑 <span>↗</span></button>
  </aside>`
}

export function createAlbumArchiveMarkup(selectedIndex = 0) {
  const selected = demoAlbums[selectedIndex]
  return `<main class="album-archive" data-album-archive>
    <header class="archive-brand"><h1>OPEN MUSIC CLUB</h1><p>MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p><small><i></i>5 张演示专辑 · 15 首演示曲目 · 5 位艺术家</small></header>
    ${archiveNavigation()}
    <section class="album-wave-stage" data-wave-field aria-label="三维专辑档案选择"><div class="archive-three-scene" data-three-scene></div></section>
    <aside class="archive-callout"><p>ALBUM / SELECT</p><strong data-album-counter>${String(selectedIndex + 1).padStart(2, '0')}</strong><span>/ 05</span></aside>
    <div class="archive-switcher" aria-label="专辑切换预览"><button type="button" data-album-previous aria-label="上一张专辑">↑</button><i></i><button type="button" data-album-next aria-label="下一张专辑">↓</button></div>
    ${albumInformation(selected, selectedIndex)}
    <section class="album-detail" data-album-detail hidden inert aria-hidden="true"></section>
    <div data-search-host></div>
    ${playerMarkup(selected)}
  </main>`
}

export function createAlbumDetailMarkup(album: DemoAlbum) {
  const tracks = album.tracks.map((track, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${track.title}</strong><small>LOCAL</small><time>${track.duration}</time></li>`).join('')
  return `
    <button class="detail-back" type="button" data-back-to-archive>←&nbsp;&nbsp;返回专辑架 <kbd>ESC</kbd></button>
    <section class="detail-cover-frame"><div class="detail-cover"><img src="${album.coverUrl}" alt="${album.title} 占位封面" /></div><p>ALBUM / ${album.id.slice(-3)}</p><small>本地占位视觉 · 未来由真实封面替换</small></section>
    <article class="detail-information" data-detail-information><p>ALBUM DETAIL&nbsp;&nbsp;/&nbsp;&nbsp;UI PREVIEW</p><h2>${album.title}</h2><h3>${album.artist}</h3>
      <div class="detail-facts"><p><small>RELEASE / 发行年份</small>${album.year}</p><p><small>ARTIST / 艺术家</small>${album.artist}</p><p><small>GENRE / 流派</small>${album.genre}</p><p><small>FORMAT / 来源</small>STATIC VISUAL</p></div>
      <p class="detail-description">${album.description}</p><section class="detail-track-preview"><header><b>01&nbsp;&nbsp;曲目预览</b><span>暂未连接播放</span></header><ol>${tracks}</ol></section>
    </article>`
}

export const wrapAlbumIndex = (value: number, count = demoAlbums.length) => ((value % count) + count) % count

export function mountAlbumArchive(root: HTMLElement) {
  let frame = 0
  let selectedIndex = 0
  let recordIndex = 16
  let disposed = false
  let scene: ArchiveScene | null = null
  let sceneReady = false
  let mode: 'archive' | 'detail' = 'archive'
  let view: 'archive' | 'search' = 'archive'
  let detailIdleSince = 0
  let searchHideTimer = 0
  let searchController: ReturnType<typeof mountSearchPage> | null = null
  let activeTrack: SearchItem | null = null
  let playRequest = 0
  let playbackController: AbortController | null = null
  const audio = new Audio()
  audio.preload = 'none'
  root.innerHTML = createAlbumArchiveMarkup(selectedIndex)
  const archive = root.querySelector<HTMLElement>('[data-album-archive]')!
  const detail = root.querySelector<HTMLElement>('[data-album-detail]')!
  const container = root.querySelector<HTMLElement>('[data-three-scene]')!
  const searchHost = root.querySelector<HTMLElement>('[data-search-host]')!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const clock = (seconds: number) => Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'

  const updatePlayer = () => {
    if (!activeTrack) return
    const footer = archive.querySelector<HTMLElement>('[data-global-player]')
    if (!footer) return
    const track = footer.querySelector<HTMLElement>('[data-player-track]')!
    const cover = track.querySelector<HTMLImageElement>('img')!
    cover.src = activeTrack.coverUrl
    cover.alt = `${activeTrack.title} 封面缩略图`
    track.querySelector('strong')!.textContent = activeTrack.title
    track.querySelector('span')!.textContent = `${activeTrack.artist} / ${activeTrack.album}`
    track.querySelector('b')!.lastChild!.textContent = activeTrack.source === 'local' ? 'LOCAL' : 'NETEASE'
    const progress = footer.querySelector<HTMLElement>('[data-player-progress]')!
    const times = progress.querySelectorAll('time')
    times[0].textContent = clock(audio.currentTime)
    times[1].textContent = Number.isFinite(audio.duration) ? clock(audio.duration) : activeTrack.duration
    const percent = Number.isFinite(audio.duration) && audio.duration > 0 ? `${Math.min(100, audio.currentTime / audio.duration * 100)}%` : '0%'
    progress.querySelector<HTMLElement>('i')!.style.width = percent
    progress.querySelector<HTMLElement>('b')!.style.left = percent
    progress.querySelector<HTMLButtonElement>('[data-player-progress-bar]')!.disabled = !Number.isFinite(audio.duration)
    const toggle = footer.querySelector<HTMLButtonElement>('[data-player-toggle]')!
    toggle.disabled = false
    toggle.setAttribute('aria-label', audio.paused ? '播放' : '暂停')
    toggle.innerHTML = audio.paused ? icons.play : icons.pause
  }

  const playTrack = async (track: SearchItem) => {
    playRequest += 1
    const request = playRequest
    playbackController?.abort()
    playbackController = new AbortController()
    const url = await resolvePlaybackUrl(track, undefined, playbackController.signal)
    if (disposed || request !== playRequest) return
    audio.pause()
    audio.src = url
    activeTrack = track
    updatePlayer()
    await audio.play()
  }

  audio.addEventListener('timeupdate', updatePlayer)
  audio.addEventListener('loadedmetadata', updatePlayer)
  audio.addEventListener('play', updatePlayer)
  audio.addEventListener('pause', updatePlayer)
  audio.addEventListener('ended', updatePlayer)
  audio.addEventListener('error', () => {
    audio.pause()
    const message = archive.querySelector<HTMLElement>('[data-global-player] > p')
    if (message) message.textContent = '音频加载失败，请重新选择歌曲。'
  })

  const onPlayerClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element) || !activeTrack) return
    if (target.closest('[data-player-toggle]')) {
      if (audio.paused) void audio.play().catch(() => undefined)
      else audio.pause()
    } else if (target.closest('[data-player-progress-bar]') && Number.isFinite(audio.duration)) {
      const bar = archive.querySelector<HTMLElement>('[data-player-progress-bar]')!
      const bounds = bar.getBoundingClientRect()
      audio.currentTime = Math.min(audio.duration, Math.max(0, (event.clientX - bounds.left) / bounds.width * audio.duration))
    }
  }
  archive.addEventListener('click', onPlayerClick)

  const animate = (now: number) => {
    frame = 0
    if (disposed || document.hidden || view === 'search' || !scene) return
    scene.update(now / 1000)
    if (mode === 'detail') {
      const visibility = scene.detailVisibility
      detail.style.setProperty('--detail-visibility', String(visibility))
      detail.style.setProperty('--detail-offset', `${(1 - visibility) * 18}px`)
      if (visibility > .995) {
        if (!detailIdleSince) detailIdleSince = now
        if (now - detailIdleSince > 1_400) {
          scene.finishDecryption()
          scene.update(now / 1000)
          return
        }
      } else detailIdleSince = 0
    } else if (!detail.hidden) {
      const visibility = scene.detailVisibility
      detail.style.setProperty('--detail-visibility', String(visibility))
      detail.style.setProperty('--detail-offset', `${(1 - visibility) * 18}px`)
      if (visibility < .01) {
        detail.hidden = true
        archive.dataset.mode = 'archive'
      }
    }
    frame = requestAnimationFrame(animate)
  }

  const wakeScene = () => {
    if (!frame && scene && view === 'archive' && !disposed && !document.hidden) frame = requestAnimationFrame(animate)
  }

  const setNavigation = (name: 'library' | 'search') => {
    for (const button of archive.querySelectorAll<HTMLButtonElement>('[data-nav="library"], [data-nav="search"]')) {
      if (button.dataset.nav === name) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
  }

  const setArchiveContentInert = (value: boolean) => {
    for (const selector of ['[data-wave-field]', '.archive-switcher', '[data-album-information]']) {
      const element = archive.querySelector<HTMLElement>(selector)
      if (element) element.inert = value
    }
  }

  const showSearch = () => {
    if (view === 'search') { searchController?.focus(); return }
    if (mode === 'detail') {
      mode = 'archive'
      detail.hidden = true
      detail.inert = true
      detail.setAttribute('aria-hidden', 'true')
      archive.dataset.mode = 'archive'
      scene?.setMode('archive')
    }
    if (!searchController) searchController = mountSearchPage(searchHost, playTrack)
    else searchController.refresh()
    window.clearTimeout(searchHideTimer)
    const page = searchHost.querySelector<HTMLElement>('[data-search-page]')!
    view = 'search'
    cancelAnimationFrame(frame)
    frame = 0
    page.hidden = false
    page.inert = false
    setArchiveContentInert(true)
    setNavigation('search')
    if (reduced) archive.dataset.view = 'search'
    else requestAnimationFrame(() => { if (!disposed && view === 'search') archive.dataset.view = 'search' })
    searchController.focus()
  }

  const hideSearch = () => {
    if (view !== 'search') return
    view = 'archive'
    archive.dataset.view = 'archive'
    setNavigation('library')
    const page = searchHost.querySelector<HTMLElement>('[data-search-page]')!
    page.inert = true
    setArchiveContentInert(false)
    window.clearTimeout(searchHideTimer)
    searchHideTimer = window.setTimeout(() => { if (view === 'archive') page.hidden = true }, reduced ? 0 : 280)
    wakeScene()
  }

  const openDetail = () => {
    if (mode !== 'archive' || !scene) return
    mode = 'detail'
    detailIdleSince = 0
    detail.innerHTML = createAlbumDetailMarkup(demoAlbums[selectedIndex])
    detail.hidden = false
    detail.inert = false
    detail.setAttribute('aria-hidden', 'false')
    detail.style.setProperty('--detail-visibility', '0')
    detail.style.setProperty('--detail-offset', '18px')
    detail.querySelector('[data-back-to-archive]')?.addEventListener('click', closeDetail)
    archive.dataset.mode = 'detail'
    scene.setMode('detail')
    wakeScene()
  }

  const closeDetail = () => {
    if (mode !== 'detail') return
    mode = 'archive'
    detailIdleSince = 0
    detail.inert = true
    detail.setAttribute('aria-hidden', 'true')
    scene?.setMode('archive')
    wakeScene()
  }

    const refreshSelection = (nextRecord: number) => {
      recordIndex = nextRecord
      selectedIndex = records[nextRecord].albumIndex
      const album = demoAlbums[selectedIndex]
      const information = root.querySelector<HTMLElement>('[data-album-information]')
      const player = root.querySelector<HTMLElement>('[data-global-player]')
      if (information) information.outerHTML = albumInformation(album, selectedIndex)
      if (player && !activeTrack) player.outerHTML = playerMarkup(album)
      const counter = root.querySelector('[data-album-counter]')
      if (counter) counter.textContent = String(selectedIndex + 1).padStart(2, '0')
      root.querySelector('[data-open-selected]')?.addEventListener('click', openDetail)
    }

    const selectRecord = (nextRecord: number, navigation?: { axis: 'row' | 'lane'; direction: number } | { cell: { lane: number; row: number } }) => {
      if (!scene) return
      refreshSelection(nextRecord)
      scene.select(nextRecord, navigation)
    }

    const navigate = (axis: 'row' | 'lane', direction: number) => {
      const current = fileLocation(recordIndex)
      const lane = axis === 'lane'
        ? (current.lane + direction + archiveColumns.length) % archiveColumns.length
        : current.lane
      const files = columnFiles(lane)
      const row = (current.row - 12 + (axis === 'row' ? direction : 0) + files.length) % files.length
      selectRecord(files[row], { axis, direction })
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (view === 'search') {
        if (event.key === 'Escape') { event.preventDefault(); hideSearch() }
        else if (event.key === '/' && event.target !== searchHost.querySelector('[data-search-input]')) {
          event.preventDefault(); searchController?.focus()
        }
        return
      }
      if (mode === 'detail') {
        if (event.key === 'Escape') { event.preventDefault(); closeDetail() }
        return
      }
      if (event.key === '/') { event.preventDefault(); showSearch(); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); navigate('row', -1) }
      if (event.key === 'ArrowDown') { event.preventDefault(); navigate('row', 1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigate('lane', -1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigate('lane', 1) }
      if (event.key === 'Enter') openDetail()
    }

    root.querySelector('[data-album-previous]')?.addEventListener('click', () => navigate('row', -1))
    root.querySelector('[data-album-next]')?.addEventListener('click', () => navigate('row', 1))
    root.querySelector('[data-open-selected]')?.addEventListener('click', openDetail)
    archive.querySelector('[data-nav="search"]')?.addEventListener('click', showSearch)
    archive.querySelector('[data-nav="library"]')?.addEventListener('click', hideSearch)
    window.addEventListener('keydown', onKeydown)
    const onResize = () => { scene?.resize(); wakeScene() }
    window.addEventListener('resize', onResize)
    const onVisibility = () => wakeScene()
    document.addEventListener('visibilitychange', onVisibility)

    void import('./rhine/scene.ts').then(async ({ ArchiveScene }) => {
      if (disposed) return
      const next = new ArchiveScene(container)
      scene = next
      next.setReduced(reduced)
      await next.load()
      if (disposed) { next.dispose(); return }
      sceneReady = true
      next.setMode('archive')
      next.onSelect = (index, cell) => selectRecord(index, cell ? { cell } : undefined)
      next.onNavigate = navigate
      next.select(recordIndex)
      next.resize()
      wakeScene()
    }).catch(() => {
      scene?.dispose()
      scene = null
      if (!disposed) container.textContent = '三维档案墙暂时无法加载，请刷新页面重试。'
    })
  return () => {
    disposed = true
    window.clearTimeout(searchHideTimer)
    searchController?.destroy()
    playRequest += 1
    playbackController?.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    archive.removeEventListener('click', onPlayerClick)
    cancelAnimationFrame(frame)
    if (sceneReady) scene?.dispose()
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
