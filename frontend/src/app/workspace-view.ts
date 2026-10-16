import { demoAlbums } from "../features/music-library/album-data.ts"
import { uiIcons as icons } from "../shared/ui/icons.ts"
import { albumInformation } from '../features/music-library/library-view.ts'
import { createPlayerMarkup, expandedPlayerMarkup } from '../features/player/player-markup.ts'
import { createQueuePanelMarkup } from "../features/queue/panel.ts"

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
