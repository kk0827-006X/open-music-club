import { createElement, createRef } from 'react'
import { renderReactMarkup } from '../../shared/react/mount.ts'
import { PlayerView } from './PlayerView.tsx'
import { createPreviewPlayer } from './preview-state.ts'
import { MusicQueue } from '../queue/model.ts'
import { createPersonalLibraryClient } from '../../services/music/personal-library.ts'
import type { PlayerPreview } from './types.ts'
import type { SearchItem } from '../../shared/music.ts'
export type { PlayerPreview } from './types.ts'

function preview(album: PlayerPreview, volume = 62) {
  const track: SearchItem = { key: 'preview', kind: 'song', source: 'netease', sourceId: '0', title: album.tracks[0]?.title ?? '',
    artist: album.artist, album: album.title, coverUrl: album.coverUrl, duration: album.tracks[0]?.duration ?? '', year: '', description: '' }
  return renderReactMarkup(createElement(PlayerView, { player: createPreviewPlayer(volume / 100), queue: new MusicQueue(),
    personalLibrary: createPersonalLibraryClient(), selectedAlbum: album, defaultTrack: track, root: createRef<HTMLElement>(),
    onExpandedChanged: () => undefined, collectionChanged: () => undefined }))
}
// 仅兼容旧的静态预览调用；内容始终来自生产 React 组件。
export function createPlayerMarkup(album: PlayerPreview, volume = 62, visible = false) {
  const footer = preview(album, volume).match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? ''
  return visible ? footer.replace('class="global-player"', 'class="global-player is-visible"') : footer
}
