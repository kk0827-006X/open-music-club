import { escapeHtml } from '../../shared/html.ts'
import { uiIcon, uiIcons as icons } from "../../shared/ui/icons.ts"
import type { SearchItem } from '../../shared/music.ts'
import type { PlayerController } from './player-core.ts'
import { createPlayerMarkup, type PlayerPreview } from './player-markup.ts'
import type { MusicQueue } from "../queue/model.ts"
import { createPersonalLibraryClient, toPersonalSong } from "../../services/music/personal-library.ts"
import { createQueuePersistence } from "../queue/persistence.ts"
import { mountQueueAddAnimation } from "../queue/add-animation.ts"
import { createQueueItemsMarkup, mountQueuePanel } from "../queue/panel.ts"
import { currentLyricIndex, loadTrackLyrics, type LyricLine } from '../../player-lyrics.ts'

export function mountPlayerView(archive: HTMLElement, options: {
  player: PlayerController; queue: MusicQueue; personalLibrary: ReturnType<typeof createPersonalLibraryClient>; reduced: boolean
  selectedAlbum(): PlayerPreview; defaultTrack(): SearchItem
  onExpandedChanged(open: boolean): void; collectionChanged(): void
}) {
  const { player, queue, personalLibrary, reduced } = options
  let disposed = false, activeTrack: SearchItem | null = player.get().track
  let lyricController: AbortController | null = null
  let lyricRequest = 0, lyricLines: LyricLine[] = [], lyricPosition = -2
  let playerVisible = false, playerExpanded = false, playerHideTimer = 0
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
    if (disposed) return
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
    if (disposed || collectionBusy) return
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
      options.collectionChanged()
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
    if (queueAddAnimation.active) return
    if (playerHideTimer || playerExpanded || !archive.querySelector<HTMLElement>('[data-player-queue-panel]')?.hidden) return
    playerHideTimer = window.setTimeout(() => {
      playerHideTimer = 0
      if (!playerExpanded && archive.querySelector<HTMLElement>('[data-player-queue-panel]')?.hidden
        && !(archive.querySelector<HTMLElement>('[data-global-player]')?.contains(document.activeElement)
          && document.activeElement instanceof HTMLElement && document.activeElement.matches(':focus-visible'))) setPlayerVisible(false)
    }, 320)
  }

  const queueAddAnimation = mountQueueAddAnimation(archive, {
    reduced,
    reveal: () => { cancelPlayerHide(); setPlayerVisible(true) },
    finish: schedulePlayerHide,
  })

  const setQueueOpen = (open: boolean) => {
    if (!open) queueInteraction.cancelDrag()
    queuePanel.hidden = !open
    archive.querySelector<HTMLButtonElement>('[data-player-queue-toggle]')!.setAttribute('aria-expanded', String(open))
    if (open) { cancelPlayerHide(); setPlayerVisible(true); syncQueueLikes(true) }
    else schedulePlayerHide()
  }

  const setPlayerExpanded = (open: boolean, restoreFocus = false) => {
    playerExpanded = open
    options.onExpandedChanged(open)
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
      options.onExpandedChanged(false)
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
    const index = currentLyricIndex(lyricLines, player.get().currentTime)
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
    queueAddAnimation.added()
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
      createPlayerMarkup(options.selectedAlbum(), Math.round(player.get().volume * 100), playerVisible || playerExpanded)
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
    times[0].textContent = clock(player.get().currentTime)
    times[1].textContent = Number.isFinite(player.get().duration) ? clock(player.get().duration) : activeTrack.duration
    const percent = Number.isFinite(player.get().duration) && player.get().duration > 0 ? `${Math.min(100, player.get().currentTime / player.get().duration * 100)}%` : '0%'
    progress.querySelector<HTMLElement>('i')!.style.width = percent
    progress.querySelector<HTMLElement>('b')!.style.left = percent
    progress.querySelector<HTMLButtonElement>('[data-player-progress-bar]')!.disabled = !Number.isFinite(player.get().duration)
    const toggle = footer.querySelector<HTMLButtonElement>('[data-player-toggle]')!
    toggle.disabled = false
    toggle.setAttribute('aria-label', player.get().paused ? '播放' : '暂停')
    toggle.innerHTML = player.get().paused ? icons.play : icons.pause
  }

  const playTrack = player.play
  const unsubscribe = player.subscribe(state => {
    const previous = activeTrack
    activeTrack = state.track
    if (activeTrack !== previous) {
      if (activeTrack) { void syncLiked(); enqueueTrack(activeTrack); updatePlayer(); requestLyrics(activeTrack) }
      else resetPlayerPreview()
    } else updatePlayer()
    if (state.error) renderLyrics(state.error)
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
        if (disposed) return
        await personalLibrary.setLiked(item, !liked)
        if (disposed) return
        queueLikes.set(item.key, !liked)
        collectionNotice(liked ? '已取消喜爱' : '已保存到喜爱')
        options.collectionChanged()
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
          player.clear()
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
      player.clear()
      updateQueue()
      setQueueOpen(false)
      return
    }
    if (target.closest('[data-player-toggle]')) {
      if (!activeTrack) {
        void playTrack(options.defaultTrack()).catch(() => undefined)
        return
      }
      void player.toggle().catch(() => undefined)
    } else if (target.closest('[data-player-previous]') && activeTrack) {
      const previous = queue.previous(activeTrack.key)
      if (previous) void playTrack(previous).catch(() => undefined)
    } else if (target.closest('[data-player-next]') && activeTrack) {
      const next = queue.next(activeTrack.key)
      if (next) void playTrack(next).catch(() => undefined)
    } else if (activeTrack && target.closest('[data-player-progress-bar]') && Number.isFinite(player.get().duration)) {
      const bar = archive.querySelector<HTMLElement>('[data-player-progress-bar]')!
      const bounds = bar.getBoundingClientRect()
      player.seek((event.clientX - bounds.left) / bounds.width)
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
      player.setVolume(Number(target.value) / 100)
      target.style.setProperty('--volume-percent', `${target.value}%`)
    }
  }
  archive.addEventListener('input', onVolumeInput)

  // 视图重挂载只读取现有状态，不创建音频或重新发起播放。
  const volume = archive.querySelector<HTMLInputElement>('[data-player-volume-input]')!
  volume.value = String(Math.round(player.get().volume * 100))
  volume.style.setProperty('--volume-percent', `${volume.value}%`)
  if (activeTrack) { updatePlayer(); requestLyrics(activeTrack); void syncLiked() }

  return {
    play: player.play, enqueue: enqueueTrack, syncLiked, choosePlaylist,
    get expanded() { return playerExpanded }, setExpanded: setPlayerExpanded, closeQueue: () => setQueueOpen(false),
    refreshPreview() { if (!activeTrack) resetPlayerPreview() },
    destroy() {
      if (disposed) return
      disposed = true; unsubscribe(); queueAddAnimation.destroy(); queuePersistence.destroy(); queueInteraction.destroy()
      window.removeEventListener('online', retryQueue); window.removeEventListener('pagehide', flushQueue)
      likeRequest++; window.clearTimeout(collectionTimer); cancelPlayerHide()
      lyricRequest++; lyricController?.abort()
      collectionForm.removeEventListener('submit', onCollectionSubmit)
      if (collectionDialog.open) collectionDialog.close()
      archive.removeEventListener('click', onPlayerClick); archive.removeEventListener('pointermove', onPlayerPointerMove)
      archive.removeEventListener('pointerout', onPlayerPointerOut); archive.removeEventListener('focusin', onPlayerFocus)
      archive.removeEventListener('error', onCoverError, true); archive.removeEventListener('input', onVolumeInput)
    },
  }
}
