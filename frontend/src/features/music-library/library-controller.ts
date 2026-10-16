import { demoAlbums, fetchAlbumTracks, type DemoAlbum } from "./album-data.ts"
import type { SearchItem, MusicActions } from '../../shared/music.ts'
import { albumInformation, createAlbumDetailMarkup } from './library-view.ts'
import { archiveColumns, columnFiles, fileLocation, records } from '../../rhine/data.ts'
import type { mountArchiveScene } from '../../graphics/archive/scene-host.ts'

export function albumTrack(album: DemoAlbum, index = 0): SearchItem {
  const track = album.tracks[index]
  return {
    key: `netease:${track.id}`, kind: 'song', source: 'netease', sourceId: track.id,
    title: track.title, artist: album.artist, album: album.title, coverUrl: album.coverUrl,
    duration: track.duration, year: album.year, description: album.description,
  }
}


export function mountMusicLibrary(archive: HTMLElement, options: {
  scene: ReturnType<typeof mountArchiveScene>; actions: MusicActions; previewChanged(): void
}) {
  const { scene } = options
  const detail = archive.querySelector<HTMLElement>('[data-album-detail]')!
  const events = new AbortController()
  let mode: 'archive' | 'detail' = 'archive', selectedIndex = 0, recordIndex = 16, disposed = false, detailIdleSince = 0
  let albumController: AbortController | null = null
  const loadedAlbums = new Map<string, DemoAlbum>()
  const openDetail = () => {
    if (mode !== 'archive' || !scene.ready) return
    mode = 'detail'
    detailIdleSince = 0
    const album = demoAlbums[selectedIndex]
    const cached = loadedAlbums.get(album.id)
    const renderDetail = (data: DemoAlbum, state: 'ready' | 'loading' | 'unavailable') => {
      detail.innerHTML = createAlbumDetailMarkup(data, state)
    }
    renderDetail(cached ?? album, cached ? 'ready' : 'loading')
    detail.hidden = false
    detail.inert = false
    detail.setAttribute('aria-hidden', 'false')
    detail.style.setProperty('--detail-visibility', '0')
    detail.style.setProperty('--detail-offset', '18px')
    archive.dataset.mode = 'detail'
    scene.setMode('detail')
    scene.wake()
    if (!cached) {
      albumController?.abort()
      albumController = new AbortController()
      void fetchAlbumTracks(album.id, undefined, albumController.signal).then((tracks) => {
        if (disposed || albumController?.signal.aborted || mode !== 'detail' || demoAlbums[selectedIndex].id !== album.id) return
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
    scene.setMode('archive')
    scene.wake()
  }

    const refreshSelection = (nextRecord: number) => {
      recordIndex = nextRecord
      selectedIndex = records[nextRecord].albumIndex
      const album = demoAlbums[selectedIndex]
      const information = archive.querySelector<HTMLElement>('[data-album-information]')
      if (information) information.outerHTML = albumInformation(album, selectedIndex)
      options.previewChanged()
      const counter = archive.querySelector('[data-album-counter]')
      if (counter) counter.textContent = String(selectedIndex + 1).padStart(2, '0')
      archive.querySelectorAll<HTMLButtonElement>('[data-album-tick]').forEach((tick) => {
        if (Number(tick.dataset.albumTick) === selectedIndex % 8) tick.setAttribute('aria-current', 'true')
        else tick.removeAttribute('aria-current')
      })
    }

    const selectRecord = (nextRecord: number, navigation?: { axis: 'row' | 'lane'; direction: number } | { cell: { lane: number; row: number } }) => {
      if (!scene.ready) return
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

  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-open-selected]')) { openDetail(); return }
    if (target?.closest('[data-back-to-archive]')) { closeDetail(); return }
    if (target?.closest('[data-album-previous]')) { navigate('row', -1); return }
    if (target?.closest('[data-album-next]')) { navigate('row', 1); return }
    const tick = target?.closest<HTMLButtonElement>('[data-album-tick]')
    if (tick) { const lane = fileLocation(recordIndex).lane; selectRecord(columnFiles(lane)[Number(tick.dataset.albumTick)], { axis: 'row', direction: 1 }); return }
    const play = target?.closest<HTMLButtonElement>('[data-album-play]'), enqueue = target?.closest<HTMLButtonElement>('[data-album-queue]')
    if (!play && !enqueue) return
    const album = loadedAlbums.get(demoAlbums[selectedIndex].id) ?? demoAlbums[selectedIndex]
    const index = album.tracks.findIndex(entry => entry.id === (play?.dataset.albumPlay ?? enqueue?.dataset.albumQueue))
    if (index < 0) return
    const track = albumTrack(album, index)
    if (enqueue) options.actions.enqueue(track)
    else void options.actions.play(track).catch(() => undefined)
  }
  archive.addEventListener('click', click, { signal: events.signal })
  return {
    get selectedAlbum() { return demoAlbums[selectedIndex] },
    get mode() { return mode }, selectRecord, navigate, openDetail, closeDetail,
    setInert(value: boolean) {
      for (const selector of ['[data-wave-field]', '.archive-switcher', '[data-album-information]']) {
        const element = archive.querySelector<HTMLElement>(selector); if (element) element.inert = value
      }
    },
    resetDetail() {
      if (mode !== 'detail') return
      mode = 'archive'; albumController?.abort(); detail.hidden = true; detail.inert = true
      detail.setAttribute('aria-hidden', 'true'); archive.dataset.mode = 'archive'; scene.setMode('archive')
    },
    afterUpdate(visibility: number, now: number) {
      if (mode === 'detail' || !detail.hidden) {
        detail.style.setProperty('--detail-visibility', String(visibility))
        detail.style.setProperty('--detail-offset', String((1 - visibility) * 18) + 'px')
        if (mode === 'detail') {
          if (visibility > .995) {
            if (!detailIdleSince) detailIdleSince = now
            if (now - detailIdleSince > 1400) return false
          } else detailIdleSince = 0
        } else if (visibility < .01) { detail.hidden = true; archive.dataset.mode = 'archive' }
      }
      return true
    },
    destroy() { disposed = true; events.abort(); albumController?.abort() },
  }
}
