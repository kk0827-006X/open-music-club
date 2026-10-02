import { demoAlbums, fetchAlbumTracks, type DemoAlbum } from './album-data.ts'
import { uiIcon, uiIcons as icons } from './ui-icons.ts'
import { mountSearchPage } from './search-page.ts'
import { mountUploadPage } from './upload-page.ts'
import { mountUserPage } from './user-page.ts'
import { createPersonalLibraryClient, toPersonalSong } from './personal-library-client.ts'
import { resolvePlaybackUrl, type SearchItem } from './music-search.ts'
import { MusicQueue } from './music-queue.ts'
import { createQueuePersistence } from './queue-persistence.ts'
import { createQueuePanelMarkup, createQueueItemsMarkup, mountQueuePanel } from './player-queue-panel.ts'
import { currentLyricIndex, loadTrackLyrics, type LyricLine } from './player-lyrics.ts'
import { archiveColumns, columnFiles, fileLocation, records } from './rhine/data.ts'
import type { ArchiveScene } from './rhine/scene.ts'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

function albumTrack(album: DemoAlbum, index = 0): SearchItem {
  const track = album.tracks[index]
  return {
    key: `netease:${track.id}`, kind: 'song', source: 'netease', sourceId: track.id,
    title: track.title, artist: album.artist, album: album.title, coverUrl: album.coverUrl,
    duration: track.duration, year: album.year, description: album.description,
  }
}

function archiveNavigation() {
  return `<nav class="archive-nav" data-archive-navigation aria-label="音乐功能预览">
    <button type="button" data-nav="library" aria-current="page">${icons.library}<span>音乐库</span></button>
    <button type="button" data-nav="search">${icons.search}<span>搜索</span></button>
    <button type="button" data-nav="upload">${icons.upload}<span>上传音乐</span></button>
    <button type="button" data-nav="user">${icons.user}<span>用户</span></button>
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

export function createPlayerMarkup(album: DemoAlbum, volume = 62, visible = false) {
  const track = album.tracks[0]
  return `<footer class="global-player${visible ? ' is-visible' : ''}" data-global-player aria-label="全站播放器">
    <section class="player-track" data-player-track>
      <img src="${album.coverUrl}" alt="${album.title} 封面缩略图" />
      <div><strong>${track.title}</strong><span>${album.artist}&nbsp;&nbsp;/&nbsp;&nbsp;${album.title}</span></div>
      <b><i></i>NETEASE</b><button type="button" data-player-like aria-label="收藏歌曲" aria-pressed="false" disabled>${icons.heart}</button>
    </section>
    <section class="player-timeline" data-player-progress><time>0:00</time><button type="button" data-player-progress-bar aria-label="播放进度" disabled><i></i><b></b></button><time>${track.duration.replace(/^0/, '')}</time></section>
    <section class="player-controls" data-player-controls>
      <button type="button" data-player-previous aria-label="上一首" disabled>${icons.previous}</button>
      <button class="player-main-control" type="button" data-player-toggle aria-label="播放">${icons.play}</button>
      <button type="button" data-player-next aria-label="下一首" disabled>${icons.next}</button>
    </section>
    <section class="player-volume" data-player-volume>${icons.volume}<input type="range" min="0" max="100" value="${volume}" style="--volume-percent:${volume}%" data-player-volume-input aria-label="音量" /></section>
    <button type="button" class="player-queue-summary" data-player-queue-toggle aria-expanded="false" aria-controls="player-queue-panel">${icons.queue}<span data-queue-count>00</span></button>
    <div class="player-tail"><p>GOOD MUSIC<br />FOR A BRIGHTER TOMORROW.</p><button type="button" class="player-open" data-player-open aria-label="展开播放器与歌词">展开歌词 <span>${icons.open}</span></button></div>
  </footer>`
}

function expandedPlayerMarkup() {
  return `<div class="player-hotspot" data-player-hotspot aria-hidden="true"></div>
    <section class="player-expanded" data-player-expanded role="dialog" aria-label="展开播放器与歌词" aria-hidden="true" inert>
      <header class="player-expanded-header"><div><strong>OPEN MUSIC CLUB</strong><span>MUSIC ARCHIVE / NOW PLAYING</span></div><button type="button" data-player-close aria-label="收起播放器">收起播放器 <span>${icons.down}</span></button></header>
      <div class="player-expanded-content">
        <section class="player-expanded-track" aria-label="当前歌曲"><p>01 / NOW PLAYING</p><img data-expanded-cover src="/images/album-placeholder-01.svg" alt="当前歌曲封面" /><strong data-expanded-title>尚未播放歌曲</strong><span data-expanded-artist>请选择一首歌曲开始播放</span><small data-expanded-source>OPEN MUSIC CLUB</small></section>
        <section class="player-expanded-lyrics" aria-label="歌词"><p>02 / LYRICS · 歌词</p><div class="player-lyrics-scroll" data-player-lyrics aria-live="off"><p class="player-lyrics-empty">播放音乐后将在这里显示歌词。</p></div></section>
        <section class="player-expanded-queue" aria-label="播放队列"><p>03 / PLAY QUEUE · 播放队列</p><ol data-expanded-queue></ol><small data-expanded-queue-empty>队列为空</small></section>
      </div>
    </section>`
}

function albumInformation(album: DemoAlbum, index: number) {
  return `<aside class="archive-selection-copy" data-album-information aria-live="polite">
    <p>ALBUM ${String(index + 1).padStart(3, '0')}</p><h2>${album.title}</h2><h3>${album.artist}</h3><span>${album.artist}</span>
    <dl>
      <div><dt>RELEASE / 发行年份</dt><dd>${album.year}</dd></div><div><dt>ARTIST / 艺术家</dt><dd>${album.artist}</dd></div>
      <div><dt>GENRE / 流派</dt><dd>${album.genre}</dd></div><div><dt>SOURCE / 来源</dt><dd><b><i></i>NETEASE</b></dd></div>
      <div><dt>TRACKS / 曲目数量</dt><dd>${album.totalTracks} 首</dd></div><div><dt>FORMAT / 播放形式</dt><dd>在线音源</dd></div>
      <div><dt>PREVIEW / 代表曲目</dt><dd>${durationOf(album)}</dd></div><div><dt>CATALOG / 目录</dt><dd>网易云音乐</dd></div>
    </dl><button type="button" data-open-selected>打开专辑 <span>${icons.open}</span></button>
  </aside>`
}

export function createAlbumArchiveMarkup(selectedIndex = 0) {
  const selected = demoAlbums[selectedIndex]
  return `<main class="album-archive" data-album-archive>
    <header class="archive-brand"><h1>OPEN MUSIC CLUB</h1><p>MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p><small><i></i>24 张精选专辑 · 3 排陈列 · 6 位艺术家</small></header>
    ${archiveNavigation()}
    <section class="album-wave-stage" data-wave-field aria-label="三维专辑档案选择"><div class="archive-three-scene" data-three-scene></div></section>
    <aside class="archive-callout"><p>ALBUM / SELECT</p><strong data-album-counter>${String(selectedIndex + 1).padStart(2, '0')}</strong><span>/ 24</span></aside>
    <div class="archive-switcher" aria-label="当前排专辑位置"><button type="button" data-album-previous aria-label="上一张专辑">${icons.up}</button><div class="archive-position-ticks">${Array.from({ length: 8 }, (_, index) => `<button type="button" data-album-tick="${index}" aria-label="当前排第 ${index + 1} 张专辑"${index === selectedIndex % 8 ? ' aria-current="true"' : ''}></button>`).join('')}</div><button type="button" data-album-next aria-label="下一张专辑">${icons.down}</button></div>
    ${albumInformation(selected, selectedIndex)}
    <section class="album-detail" data-album-detail hidden inert aria-hidden="true"></section>
    <div data-search-host></div>
    <div data-upload-host></div>
    <div data-user-host></div>
    ${expandedPlayerMarkup()}
    ${createPlayerMarkup(selected)}
    ${createQueuePanelMarkup()}
  </main>`
}

export function createAlbumDetailMarkup(album: DemoAlbum, trackState: 'ready' | 'loading' | 'unavailable' = 'ready') {
  const tracks = album.tracks.map((track, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(track.title)}</strong><small>NETEASE</small><time>${track.duration}</time><button type="button" data-album-play="${track.id}">${icons.play} 播放</button><button type="button" data-album-queue="${track.id}">${icons.plus} 队列</button></li>`).join('')
  const trackHeading = trackState === 'loading' ? '正在获取专辑全部曲目…' : trackState === 'unavailable' ? '完整曲目暂时不可用 · 以下为代表曲目' : '专辑曲目'
  return `
    <button class="detail-back" type="button" data-back-to-archive>${icons.left}&nbsp;&nbsp;返回专辑架 <kbd>ESC</kbd></button>
    <section class="detail-cover-frame"><div class="detail-cover"><img src="${album.coverUrl}" alt="${escapeHtml(album.title)} 封面" /></div><p>ALBUM / ${album.id}</p><small>网易云音乐 · 真实专辑封面</small></section>
    <article class="detail-information" data-detail-information><p>ALBUM DETAIL&nbsp;&nbsp;/&nbsp;&nbsp;MUSIC ARCHIVE</p><h2>${escapeHtml(album.title)}</h2><h3>${escapeHtml(album.artist)}</h3>
      <div class="detail-facts"><p><small>RELEASE / 发行年份</small>${album.year}</p><p><small>ARTIST / 艺术家</small>${escapeHtml(album.artist)}</p><p><small>GENRE / 流派</small>${album.genre}</p><p><small>SOURCE / 来源</small>NETEASE</p></div>
      <p class="detail-description">${escapeHtml(album.description)}</p><section class="detail-track-preview" aria-live="polite"><header><b>01&nbsp;&nbsp;${trackHeading}</b><span>专辑共 ${album.totalTracks} 首</span></header><ol>${trackState === 'loading' ? '' : tracks}</ol></section>
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
  let view: 'archive' | 'search' | 'upload' | 'user' = 'archive'
  let detailIdleSince = 0
  let searchHideTimer = 0
  let uploadHideTimer = 0
  let userHideTimer = 0
  let searchController: ReturnType<typeof mountSearchPage> | null = null
  let uploadController: ReturnType<typeof mountUploadPage> | null = null
  let userController: ReturnType<typeof mountUserPage> | null = null
  let activeTrack: SearchItem | null = null
  let playRequest = 0
  let playbackController: AbortController | null = null
  let lyricController: AbortController | null = null
  let lyricRequest = 0
  let lyricLines: LyricLine[] = []
  let lyricPosition = -2
  let playerVisible = false
  let playerExpanded = false
  let playerHideTimer = 0
  let albumController: AbortController | null = null
  const loadedAlbums = new Map<string, DemoAlbum>()
  const queue = new MusicQueue()
  const audio = new Audio()
  audio.preload = 'none'
  audio.volume = 0.62
  root.innerHTML = createAlbumArchiveMarkup(selectedIndex)
  const archive = root.querySelector<HTMLElement>('[data-album-archive]')!
  const detail = root.querySelector<HTMLElement>('[data-album-detail]')!
  const container = root.querySelector<HTMLElement>('[data-three-scene]')!
  const searchHost = root.querySelector<HTMLElement>('[data-search-host]')!
  const uploadHost = root.querySelector<HTMLElement>('[data-upload-host]')!
  const userHost = root.querySelector<HTMLElement>('[data-user-host]')!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const personalLibrary = createPersonalLibraryClient()
  const queuePanel = archive.querySelector<HTMLElement>('[data-player-queue-panel]')!
  const queueLikes = new Map<string, boolean>()
  const pendingQueueLikes = new Set<string>()
  let likeRequest = 0
  let collectionBusy = false
  let collectionTimer = 0
  let playlistCandidate: SearchItem | null = null
  archive.insertAdjacentHTML('beforeend', `<p class="collection-feedback" data-collection-feedback role="status" hidden></p><dialog class="user-create-dialog" data-collection-dialog aria-label="将歌曲加入歌单"><form data-collection-form><header><span>ADD TO PLAYLIST / 加入歌单</span><button type="button" data-collection-close aria-label="关闭歌单选择">${icons.close}</button></header><h2>加入歌单</h2><p data-collection-message role="status"></p><label for="collection-playlist">选择自己的歌单</label><select id="collection-playlist" name="playlist" required></select><div class="user-dialog-actions"><button type="button" data-collection-close>取消</button><button type="submit">保存到歌单 ${icons.right}</button></div></form></dialog>`)
  const collectionDialog = archive.querySelector<HTMLDialogElement>('[data-collection-dialog]')!
  const collectionForm = archive.querySelector<HTMLFormElement>('[data-collection-form]')!
  const collectionNotice = (message: string) => {
    if (disposed) return
    const notice = archive.querySelector<HTMLElement>('[data-collection-feedback]')!
    notice.textContent = message; notice.hidden = false
    window.clearTimeout(collectionTimer)
    collectionTimer = window.setTimeout(() => { notice.hidden = true }, 5000)
  }
  const syncLiked = async () => {
    const track = activeTrack
    const current = ++likeRequest
    const button = archive.querySelector<HTMLButtonElement>('[data-player-like]')!
    button.disabled = true
    if (!track) return
    try {
      const liked = await personalLibrary.isLiked(track)
      if (disposed || current !== likeRequest) return
      button.setAttribute('aria-pressed', String(liked))
      button.setAttribute('aria-label', liked ? '取消收藏歌曲' : '收藏歌曲')
      button.disabled = false
    } catch (error) {
      if (!disposed && current === likeRequest) { button.disabled = false; collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败') }
    }
  }
  const choosePlaylist = async (song: SearchItem) => {
    if (collectionBusy) return
    collectionBusy = true
    playlistCandidate = song
    const message = archive.querySelector<HTMLElement>('[data-collection-message]')!
    const select = collectionForm.querySelector<HTMLSelectElement>('select')!
    const submit = collectionForm.querySelector<HTMLButtonElement>('[type="submit"]')!
    message.textContent = '正在读取歌单…'; select.innerHTML = ''; submit.disabled = true
    if (!collectionDialog.open) collectionDialog.showModal()
    try {
      const playlists = await personalLibrary.playlists()
      if (disposed) return
      select.innerHTML = playlists.map((list) => `<option value="${list.id}">${escapeHtml(list.name)}</option>`).join('')
      message.textContent = playlists.length ? `将「${song.title}」保存到歌单。` : '还没有歌单，请先到用户页面新建。'
      submit.disabled = playlists.length === 0
    } catch (error) { if (!disposed) message.textContent = error instanceof Error ? error.message : '歌单读取失败' }
    finally { collectionBusy = false }
  }
  const onCollectionSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const id = Number(new FormData(collectionForm).get('playlist'))
    if (!playlistCandidate || !id || collectionBusy) return
    collectionBusy = true
    const submit = collectionForm.querySelector<HTMLButtonElement>('[type="submit"]')!
    submit.disabled = true
    try {
      await personalLibrary.addTrack(id, playlistCandidate)
      if (disposed) return
      collectionDialog.close(); collectionNotice('歌曲已保存到歌单')
      if (view === 'user') void userController?.refresh()
    } catch (error) { if (!disposed) archive.querySelector<HTMLElement>('[data-collection-message]')!.textContent = error instanceof Error ? error.message : '保存失败' }
    finally { collectionBusy = false; submit.disabled = false }
  }
  collectionForm.addEventListener('submit', onCollectionSubmit)

  const setPlayerVisible = (visible: boolean) => {
    playerVisible = visible
    archive.querySelector<HTMLElement>('[data-global-player]')?.classList.toggle('is-visible', visible || playerExpanded)
  }

  const cancelPlayerHide = () => {
    window.clearTimeout(playerHideTimer)
    playerHideTimer = 0
  }

  const schedulePlayerHide = () => {
    if (playerHideTimer || playerExpanded || !archive.querySelector<HTMLElement>('[data-player-queue-panel]')?.hidden) return
    playerHideTimer = window.setTimeout(() => {
      playerHideTimer = 0
      if (!playerExpanded && archive.querySelector<HTMLElement>('[data-player-queue-panel]')?.hidden
        && !(archive.querySelector<HTMLElement>('[data-global-player]')?.contains(document.activeElement)
          && document.activeElement instanceof HTMLElement && document.activeElement.matches(':focus-visible'))) setPlayerVisible(false)
    }, 320)
  }

  const setQueueOpen = (open: boolean) => {
    if (!open) queueInteraction.cancelDrag()
    queuePanel.hidden = !open
    archive.querySelector<HTMLButtonElement>('[data-player-queue-toggle]')!.setAttribute('aria-expanded', String(open))
    if (open) { cancelPlayerHide(); setPlayerVisible(true); syncQueueLikes(true) }
    else schedulePlayerHide()
  }

  const setPlayerExpanded = (open: boolean, restoreFocus = false) => {
    playerExpanded = open
    const expanded = archive.querySelector<HTMLElement>('[data-player-expanded]')!
    expanded.classList.toggle('is-open', open)
    expanded.inert = !open
    expanded.setAttribute('aria-hidden', String(!open))
    if (open) {
      setQueueOpen(false)
      cancelPlayerHide()
      setPlayerVisible(true)
      archive.querySelector<HTMLButtonElement>('[data-player-close]')?.focus()
    } else {
      if (restoreFocus) archive.querySelector<HTMLButtonElement>('[data-player-open]')?.focus()
      else if (document.activeElement instanceof HTMLElement && expanded.contains(document.activeElement)) document.activeElement.blur()
      schedulePlayerHide()
      wakeScene()
    }
  }

  const renderExpandedTrack = () => {
    const track = activeTrack
    const cover = archive.querySelector<HTMLImageElement>('[data-expanded-cover]')!
    const coverUrl = track?.coverUrl ?? '/images/album-placeholder-01.svg'
    if (cover.getAttribute('src') !== coverUrl) cover.src = coverUrl
    cover.alt = track ? `${track.title} 封面` : '当前歌曲封面'
    archive.querySelector<HTMLElement>('[data-expanded-title]')!.textContent = track?.title ?? '尚未播放歌曲'
    archive.querySelector<HTMLElement>('[data-expanded-artist]')!.textContent = track ? `${track.artist} / ${track.album}` : '请选择一首歌曲开始播放'
    archive.querySelector<HTMLElement>('[data-expanded-source]')!.textContent = track?.source === 'local' ? 'LOCAL / 社区音乐' : track ? 'NETEASE / 网易云音乐' : 'OPEN MUSIC CLUB'
  }

  const renderLyrics = (message?: string) => {
    const host = archive.querySelector<HTMLElement>('[data-player-lyrics]')!
    host.replaceChildren()
    if (message || lyricLines.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'player-lyrics-empty'
      empty.textContent = message ?? '此歌曲暂无歌词。'
      host.append(empty)
      return
    }
    for (const line of lyricLines) {
      const paragraph = document.createElement('p')
      paragraph.textContent = line.text
      host.append(paragraph)
    }
    lyricPosition = -2
  }

  const syncLyrics = () => {
    if (lyricLines.length === 0) return
    const index = currentLyricIndex(lyricLines, audio.currentTime)
    if (index === lyricPosition) return
    lyricPosition = index
    const host = archive.querySelector<HTMLElement>('[data-player-lyrics]')!
    host.querySelector('.is-current')?.classList.remove('is-current')
    const line = host.children.item(index)
    if (line) {
      line.classList.add('is-current')
      if (playerExpanded) line.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' })
    }
  }

  const requestLyrics = (track: SearchItem) => {
    lyricRequest += 1
    const request = lyricRequest
    lyricController?.abort()
    lyricController = new AbortController()
    lyricLines = []
    renderLyrics(track.source === 'local' ? '本地音乐暂无歌词。' : '正在读取歌词…')
    void loadTrackLyrics(track, undefined, lyricController.signal).then((lines) => {
      if (disposed || request !== lyricRequest) return
      lyricLines = lines
      renderLyrics(lines.length ? undefined : '此歌曲暂无歌词。')
      syncLyrics()
    })
  }

  const clock = (seconds: number) => Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00'

  const updateQueue = () => {
    queuePersistence.changed()
    queueInteraction.cancelDrag()
    const count = String(queue.items.length).padStart(2, '0')
    archive.querySelectorAll('[data-queue-count]').forEach((element) => { element.textContent = count })
    const list = archive.querySelector<HTMLOListElement>('[data-queue-items]')!
    list.innerHTML = createQueueItemsMarkup(queue.items, activeTrack?.key, queueLikes)
    const expandedQueue = archive.querySelector<HTMLOListElement>('[data-expanded-queue]')!
    expandedQueue.innerHTML = queue.items.map((item, index) => `<li${item.key === activeTrack?.key ? ' class="is-active"' : ''}><button type="button" data-queue-play="${escapeHtml(item.key)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.artist)}</small></button></li>`).join('')
    archive.querySelector<HTMLElement>('[data-expanded-queue-empty]')!.hidden = queue.items.length > 0
    archive.querySelector<HTMLElement>('[data-queue-empty]')!.hidden = queue.items.length > 0
    archive.querySelector<HTMLButtonElement>('[data-queue-clear]')!.disabled = queue.items.length === 0
    archive.querySelector<HTMLButtonElement>('[data-player-queue-toggle]')!.setAttribute(
      'aria-expanded', String(!archive.querySelector<HTMLElement>('[data-player-queue-panel]')!.hidden),
    )
    archive.querySelector<HTMLButtonElement>('[data-player-previous]')!.disabled = !activeTrack || !queue.previous(activeTrack.key)
    archive.querySelector<HTMLButtonElement>('[data-player-next]')!.disabled = !activeTrack || !queue.next(activeTrack.key)
    if (!queuePanel.hidden) syncQueueLikes()
  }

  const queueInteraction = mountQueuePanel(queuePanel, {
    reduced, toggle: () => archive.querySelector('[data-player-queue-toggle]'), close: () => setQueueOpen(false),
    reorder(key, index) {
      let current = queue.items.findIndex(item => item.key === key)
      if (current < 0) return
      while (current !== index) { const direction = index > current ? 1 : -1; queue.move(key, direction); current += direction }
      updateQueue()
      queuePanel.querySelector<HTMLElement>('[data-queue-order-status]')!.textContent = `歌曲已移动到第 ${index + 1} 位`
    },
  })

  const renderQueueLikes = () => {
    queuePanel.querySelectorAll<HTMLButtonElement>('[data-queue-like]').forEach(button => {
      const key = button.dataset.queueLike!
      const item = queue.items.find(entry => entry.key === key)
      if (!item || !queueLikes.has(key)) return
      const liked = queueLikes.get(key) === true
      button.setAttribute('aria-pressed', String(liked))
      button.setAttribute('aria-label', `${liked ? '取消收藏' : '收藏'} ${item.title}`)
      button.title = liked ? '取消收藏' : '收藏'
      button.innerHTML = uiIcon('heart', liked)
      button.disabled = pendingQueueLikes.has(key)
    })
  }
  const syncQueueLikes = (refresh = false) => {
    for (const item of queue.items) {
      if (pendingQueueLikes.has(item.key) || (!refresh && queueLikes.has(item.key))) continue
      pendingQueueLikes.add(item.key)
      void personalLibrary.isLiked(item).then(liked => { if (!disposed) queueLikes.set(item.key, liked) })
        .catch(error => collectionNotice(error instanceof Error ? error.message : '收藏状态读取失败'))
        .finally(() => { pendingQueueLikes.delete(item.key); if (!disposed) renderQueueLikes() })
    }
    renderQueueLikes()
  }

  const enqueueTrack = (track: SearchItem) => {
    if (queue.items.length >= 500 && !queue.items.some(item => item.key === track.key)) {
      collectionNotice('播放队列最多保存 500 首，请先移除部分歌曲')
      return
    }
    queue.add(track)
    updateQueue()
  }

  const queuePersistence = createQueuePersistence({
    read: () => queue.items,
    load: async () => (await personalLibrary.queue()).map(toPersonalSong),
    save: tracks => personalLibrary.saveQueue(tracks),
    restore: tracks => { queue.restore(tracks); updateQueue() },
    notice: collectionNotice,
  })
  const retryQueue = () => { void queuePersistence.retry() }
  const flushQueue = () => { void queuePersistence.flush() }
  window.addEventListener('online', retryQueue)
  window.addEventListener('pagehide', flushQueue)
  void queuePersistence.start()

  const resetPlayerPreview = () => {
    likeRequest += 1
    archive.querySelector<HTMLElement>('[data-global-player]')!.outerHTML =
      createPlayerMarkup(demoAlbums[selectedIndex], Math.round(audio.volume * 100), playerVisible || playerExpanded)
    lyricRequest += 1
    lyricController?.abort()
    lyricLines = []
    renderExpandedTrack()
    renderLyrics('播放音乐后将在这里显示歌词。')
    updateQueue()
  }

  const updatePlayer = () => {
    if (!activeTrack) return
    renderExpandedTrack()
    syncLyrics()
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
    void syncLiked()
    enqueueTrack(track)
    updatePlayer()
    requestLyrics(track)
    await audio.play()
  }

  audio.addEventListener('timeupdate', updatePlayer)
  audio.addEventListener('loadedmetadata', updatePlayer)
  audio.addEventListener('play', updatePlayer)
  audio.addEventListener('pause', updatePlayer)
  audio.addEventListener('ended', () => {
    updatePlayer()
    const next = activeTrack && queue.next(activeTrack.key)
    if (next) void playTrack(next).catch(() => undefined)
  })
  audio.addEventListener('error', () => {
    audio.pause()
    renderLyrics('音频加载失败，请重新选择歌曲。')
  })

  const onPlayerClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-collection-close]')) { collectionDialog.close(); return }
    const save = target.closest<HTMLButtonElement>('[data-queue-save]')
    if (save) {
      const item = queue.items.find((entry) => entry.key === save.dataset.queueSave)
      if (item) void choosePlaylist(item)
      return
    }
    const heart = target.closest<HTMLButtonElement>('[data-player-like], [data-queue-like]')
    if (heart) {
      const item = heart.hasAttribute('data-player-like') ? activeTrack : queue.items.find((entry) => entry.key === heart.dataset.queueLike)
      if (!item || heart.disabled) return
      if (pendingQueueLikes.has(item.key)) return
      pendingQueueLikes.add(item.key)
      heart.disabled = true
      renderQueueLikes()
      void personalLibrary.isLiked(item).then(async (liked) => {
        await personalLibrary.setLiked(item, !liked)
        queueLikes.set(item.key, !liked)
        collectionNotice(liked ? '已取消喜爱' : '已保存到喜爱')
        if (view === 'user') void userController?.refresh()
        void syncLiked()
      }).catch((error) => collectionNotice(error instanceof Error ? error.message : '收藏保存失败'))
        .finally(() => { pendingQueueLikes.delete(item.key); if (!disposed) { heart.disabled = false; renderQueueLikes() } })
      return
    }
    if (target.closest('[data-player-close]')) { setPlayerExpanded(false); return }
    if (target.closest('[data-player-open]')) { setPlayerExpanded(true); return }
    const queueToggle = target.closest<HTMLButtonElement>('[data-player-queue-toggle]')
    if (queueToggle) {
      setQueueOpen(queuePanel.hidden)
      return
    }
    const queueAction = target.closest<HTMLButtonElement>('[data-queue-play], [data-queue-remove]')
    if (queueAction) {
      const key = Object.values(queueAction.dataset).find((value) => value?.includes(':'))
      if (!key) return
      if (queueAction.hasAttribute('data-queue-remove')) {
        queue.remove(key)
        if (activeTrack?.key === key) {
          playRequest += 1
          playbackController?.abort()
          audio.pause()
          audio.removeAttribute('src')
          activeTrack = null
          resetPlayerPreview()
        }
      } else {
        const item = queue.items.find((entry) => entry.key === key)
        if (item) void playTrack(item).catch(() => undefined)
      }
      updateQueue()
      return
    }
    if (target.closest('[data-queue-clear]')) {
      queue.clear()
      playRequest += 1
      playbackController?.abort()
      audio.pause()
      audio.removeAttribute('src')
      activeTrack = null
      resetPlayerPreview()
      setQueueOpen(false)
      return
    }
    const albumPlay = target.closest<HTMLButtonElement>('[data-album-play]')
    const albumQueue = target.closest<HTMLButtonElement>('[data-album-queue]')
    if (albumPlay || albumQueue) {
      const album = loadedAlbums.get(demoAlbums[selectedIndex].id) ?? demoAlbums[selectedIndex]
      const track = album.tracks.find((entry) => entry.id === (albumPlay?.dataset.albumPlay ?? albumQueue?.dataset.albumQueue))
      if (!track) return
      const item = albumTrack(album, album.tracks.indexOf(track))
      if (albumQueue) enqueueTrack(item)
      else void playTrack(item).catch(() => undefined)
      return
    }
    if (target.closest('[data-player-toggle]')) {
      if (!activeTrack) {
        void playTrack(albumTrack(demoAlbums[selectedIndex])).catch(() => undefined)
        return
      }
      if (audio.paused) void audio.play().catch(() => undefined)
      else audio.pause()
    } else if (target.closest('[data-player-previous]') && activeTrack) {
      const previous = queue.previous(activeTrack.key)
      if (previous) void playTrack(previous).catch(() => undefined)
    } else if (target.closest('[data-player-next]') && activeTrack) {
      const next = queue.next(activeTrack.key)
      if (next) void playTrack(next).catch(() => undefined)
    } else if (activeTrack && target.closest('[data-player-progress-bar]') && Number.isFinite(audio.duration)) {
      const bar = archive.querySelector<HTMLElement>('[data-player-progress-bar]')!
      const bounds = bar.getBoundingClientRect()
      audio.currentTime = Math.min(audio.duration, Math.max(0, (event.clientX - bounds.left) / bounds.width * audio.duration))
    } else if (target.closest('[data-global-player]') && !target.closest('button, input')) {
      setPlayerExpanded(true)
    }
  }
  archive.addEventListener('click', onPlayerClick)
  const onPlayerPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || playerExpanded) return
    if (event.clientY >= window.innerHeight - 30 || (event.target instanceof Element && event.target.closest('[data-global-player], [data-player-queue-panel]'))) {
      cancelPlayerHide()
      setPlayerVisible(true)
    } else if (playerVisible) schedulePlayerHide()
  }
  const onPlayerPointerOut = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-global-player], [data-player-queue-panel]')) return
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-global-player], [data-player-queue-panel]')) return
    schedulePlayerHide()
  }
  archive.addEventListener('pointermove', onPlayerPointerMove)
  archive.addEventListener('pointerout', onPlayerPointerOut)
  const onPlayerFocus = (event: FocusEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-global-player]')) setPlayerVisible(true)
  }
  archive.addEventListener('focusin', onPlayerFocus)
  const onCoverError = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLImageElement && !target.src.endsWith('album-placeholder-01.svg')) {
      target.src = '/images/album-placeholder-01.svg'
    }
  }
  archive.addEventListener('error', onCoverError, true)
  const onVolumeInput = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.matches('[data-player-volume-input]')) {
      audio.volume = Number(target.value) / 100
      target.style.setProperty('--volume-percent', `${target.value}%`)
    }
  }
  archive.addEventListener('input', onVolumeInput)

  const animate = (now: number) => {
    frame = 0
    if (disposed || document.hidden || view !== 'archive' || playerExpanded || !scene) return
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

  const setNavigation = (name: 'library' | 'search' | 'upload' | 'user') => {
    for (const button of archive.querySelectorAll<HTMLButtonElement>('[data-nav="library"], [data-nav="search"], [data-nav="upload"], [data-nav="user"]')) {
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
    if (view === 'upload') hideUpload()
    if (view === 'user') hideUser()
    if (mode === 'detail') {
      mode = 'archive'
      detail.hidden = true
      detail.inert = true
      detail.setAttribute('aria-hidden', 'true')
      archive.dataset.mode = 'archive'
      scene?.setMode('archive')
    }
    if (!searchController) searchController = mountSearchPage(searchHost, playTrack, undefined, enqueueTrack)
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
    searchHideTimer = window.setTimeout(() => { if (view !== 'search') page.hidden = true }, reduced ? 0 : 280)
    wakeScene()
  }

  const showUpload = () => {
    if (view === 'upload') return
    if (view === 'search') hideSearch()
    if (view === 'user') hideUser()
    if (mode === 'detail') {
      mode = 'archive'
      detail.hidden = true
      detail.inert = true
      detail.setAttribute('aria-hidden', 'true')
      archive.dataset.mode = 'archive'
      scene?.setMode('archive')
    }
    if (!uploadController) uploadController = mountUploadPage(uploadHost)
    window.clearTimeout(uploadHideTimer)
    const page = uploadHost.querySelector<HTMLElement>('[data-upload-page]')!
    view = 'upload'
    cancelAnimationFrame(frame)
    frame = 0
    page.hidden = false
    page.inert = false
    setArchiveContentInert(true)
    setNavigation('upload')
    if (reduced) archive.dataset.view = 'upload'
    else requestAnimationFrame(() => { if (!disposed && view === 'upload') archive.dataset.view = 'upload' })
  }

  const hideUpload = () => {
    if (view !== 'upload') return
    view = 'archive'
    archive.dataset.view = 'archive'
    setNavigation('library')
    const page = uploadHost.querySelector<HTMLElement>('[data-upload-page]')!
    page.inert = true
    setArchiveContentInert(false)
    window.clearTimeout(uploadHideTimer)
    uploadHideTimer = window.setTimeout(() => { if (view !== 'upload') page.hidden = true }, reduced ? 0 : 300)
    wakeScene()
  }

  const showUser = () => {
    if (view === 'user') return
    if (view === 'search') hideSearch()
    if (view === 'upload') hideUpload()
    if (mode === 'detail') {
      mode = 'archive'
      detail.hidden = true
      detail.inert = true
      detail.setAttribute('aria-hidden', 'true')
      archive.dataset.mode = 'archive'
      scene?.setMode('archive')
    }
    if (!userController) userController = mountUserPage(userHost, {
      client: personalLibrary, play: playTrack, enqueue: enqueueTrack,
      choosePlaylist: (song) => { void choosePlaylist(song) }, changed: () => { void syncLiked() },
    })
    void userController.refresh()
    window.clearTimeout(userHideTimer)
    const page = userHost.querySelector<HTMLElement>('[data-user-page]')!
    view = 'user'
    cancelAnimationFrame(frame)
    frame = 0
    page.hidden = false
    page.inert = false
    setArchiveContentInert(true)
    setNavigation('user')
    if (reduced) archive.dataset.view = 'user'
    else requestAnimationFrame(() => { if (!disposed && view === 'user') archive.dataset.view = 'user' })
  }

  const hideUser = () => {
    if (view !== 'user') return
    view = 'archive'
    archive.dataset.view = 'archive'
    setNavigation('library')
    const page = userHost.querySelector<HTMLElement>('[data-user-page]')!
    page.inert = true
    setArchiveContentInert(false)
    window.clearTimeout(userHideTimer)
    userHideTimer = window.setTimeout(() => { if (view !== 'user') page.hidden = true }, reduced ? 0 : 300)
    wakeScene()
  }

  const openDetail = () => {
    if (mode !== 'archive' || !scene) return
    mode = 'detail'
    detailIdleSince = 0
    const album = demoAlbums[selectedIndex]
    const cached = loadedAlbums.get(album.id)
    const renderDetail = (data: DemoAlbum, state: 'ready' | 'loading' | 'unavailable') => {
      detail.innerHTML = createAlbumDetailMarkup(data, state)
      detail.querySelector('[data-back-to-archive]')?.addEventListener('click', closeDetail)
    }
    renderDetail(cached ?? album, cached ? 'ready' : 'loading')
    detail.hidden = false
    detail.inert = false
    detail.setAttribute('aria-hidden', 'false')
    detail.style.setProperty('--detail-visibility', '0')
    detail.style.setProperty('--detail-offset', '18px')
    archive.dataset.mode = 'detail'
    scene.setMode('detail')
    wakeScene()
    if (!cached) {
      albumController?.abort()
      albumController = new AbortController()
      void fetchAlbumTracks(album.id, undefined, albumController.signal).then((tracks) => {
        if (disposed || mode !== 'detail' || demoAlbums[selectedIndex].id !== album.id) return
        const complete = { ...album, tracks, totalTracks: tracks.length }
        loadedAlbums.set(album.id, complete)
        renderDetail(complete, 'ready')
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!disposed && mode === 'detail' && demoAlbums[selectedIndex].id === album.id) renderDetail(album, 'unavailable')
      })
    }
  }

  const closeDetail = () => {
    if (mode !== 'detail') return
    mode = 'archive'
    albumController?.abort()
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
      if (player && !activeTrack) {
        player.outerHTML = createPlayerMarkup(album, Math.round(audio.volume * 100), playerVisible || playerExpanded)
        updateQueue()
      }
      const counter = root.querySelector('[data-album-counter]')
      if (counter) counter.textContent = String(selectedIndex + 1).padStart(2, '0')
      root.querySelectorAll<HTMLButtonElement>('[data-album-tick]').forEach((tick) => {
        if (Number(tick.dataset.albumTick) === selectedIndex % 8) tick.setAttribute('aria-current', 'true')
        else tick.removeAttribute('aria-current')
      })
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
      if (playerExpanded) {
        if (event.key === 'Escape') { event.preventDefault(); setPlayerExpanded(false, true) }
        return
      }
      if (view === 'search') {
        if (event.key === 'Escape') { event.preventDefault(); hideSearch() }
        else if (event.key === '/' && event.target !== searchHost.querySelector('[data-search-input]')) {
          event.preventDefault(); searchController?.focus()
        }
        return
      }
      if (view === 'upload') {
        if (event.key === 'Escape') { event.preventDefault(); hideUpload() }
        return
      }
      if (view === 'user') {
        if (event.key === 'Escape' && !userHost.querySelector<HTMLDialogElement>('[data-user-dialog]')?.open) { event.preventDefault(); hideUser() }
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
    root.querySelectorAll<HTMLButtonElement>('[data-album-tick]').forEach((tick) => tick.addEventListener('click', () => {
      const lane = fileLocation(recordIndex).lane
      selectRecord(columnFiles(lane)[Number(tick.dataset.albumTick)], { axis: 'row', direction: 1 })
    }))
    root.querySelector('[data-open-selected]')?.addEventListener('click', openDetail)
    archive.querySelector('[data-nav="search"]')?.addEventListener('click', showSearch)
    archive.querySelector('[data-nav="upload"]')?.addEventListener('click', showUpload)
    archive.querySelector('[data-nav="user"]')?.addEventListener('click', showUser)
    archive.querySelector('[data-nav="library"]')?.addEventListener('click', () => { hideSearch(); hideUpload(); hideUser() })
    uploadHost.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('[data-upload-back]')) hideUpload() })
    window.addEventListener('keydown', onKeydown)
    const onResize = () => { scene?.resize(); wakeScene() }
    window.addEventListener('resize', onResize)
    const onVisibility = () => wakeScene()
    document.addEventListener('visibilitychange', onVisibility)

    void import('./rhine/scene.ts').then(async ({ ArchiveScene }) => {
      if (disposed) return
      const next = new ArchiveScene(container)
      scene = next
      next.onCoverUpdate = wakeScene
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
    queuePersistence.destroy()
    window.removeEventListener('online', retryQueue)
    window.removeEventListener('pagehide', flushQueue)
    queueInteraction.destroy()
    likeRequest += 1
    window.clearTimeout(collectionTimer)
    collectionForm.removeEventListener('submit', onCollectionSubmit)
    if (collectionDialog.open) collectionDialog.close()
    window.clearTimeout(searchHideTimer)
    window.clearTimeout(uploadHideTimer)
    window.clearTimeout(userHideTimer)
    searchController?.destroy()
    uploadController?.destroy()
    userController?.destroy()
    playRequest += 1
    playbackController?.abort()
    lyricController?.abort()
    cancelPlayerHide()
    albumController?.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    archive.removeEventListener('click', onPlayerClick)
    archive.removeEventListener('pointermove', onPlayerPointerMove)
    archive.removeEventListener('pointerout', onPlayerPointerOut)
    archive.removeEventListener('focusin', onPlayerFocus)
    archive.removeEventListener('error', onCoverError, true)
    archive.removeEventListener('input', onVolumeInput)
    cancelAnimationFrame(frame)
    if (sceneReady) scene?.dispose()
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
