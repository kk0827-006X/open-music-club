import { uiIcons as icons } from "../../shared/ui/icons.ts"
export type PlayerPreview = { title: string; artist: string; coverUrl: string; tracks: readonly { title: string; duration: string }[] }

export function createPlayerMarkup(album: PlayerPreview, volume = 62, visible = false) {
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

export function expandedPlayerMarkup() {
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
