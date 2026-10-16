import { escapeHtml } from '../../shared/html.ts'
import { demoAlbums, type DemoAlbum } from "./album-data.ts"
import { uiIcons as icons } from "../../shared/ui/icons.ts"

function durationOf(album: DemoAlbum) {
  const seconds = album.tracks.reduce((total, track) => {
    const [minutes, remainder] = track.duration.split(':').map(Number)
    return total + minutes * 60 + remainder
  }, 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function albumInformation(album: DemoAlbum, index: number) {
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
