import { demoAlbums, type DemoAlbum } from './album-data.ts'

type Source = 'local' | 'netease'
type Kind = 'song' | 'album' | 'artist'
type SourceFilter = Source | 'all'

interface SearchItem {
  key: string
  kind: Kind
  source: Source
  title: string
  artist: string
  album: string
  coverUrl: string
  duration: string
  year: string
  description: string
}

// 仅供前端排版与筛选预览；来源标识不代表真实可播放音源。
export const demoSearchItems: SearchItem[] = demoAlbums.flatMap((album: DemoAlbum, albumIndex) => {
  const source: Source = albumIndex % 2 === 0 ? 'local' : 'netease'
  const common = {
    source,
    artist: album.artist,
    album: album.title,
    coverUrl: album.coverUrl,
    year: album.year,
    description: album.description,
  }
  return [
    ...album.tracks.map((track, index) => ({
      ...common,
      key: `${source}:${album.id}:song:${index}`,
      kind: 'song' as const,
      title: track.title,
      duration: track.duration,
    })),
    { ...common, key: `${source}:${album.id}:album`, kind: 'album' as const, title: album.title, duration: '—' },
    { ...common, key: `${source}:${album.id}:artist`, kind: 'artist' as const, title: album.artist, duration: '—' },
  ]
})

export function filterDemoSearchItems(query: string, source: SourceFilter, kind: Kind) {
  const normalized = query.trim().toLocaleLowerCase()
  return demoSearchItems.filter((item) =>
    item.kind === kind
    && (source === 'all' || item.source === source)
    && (!normalized || [item.title, item.artist, item.album].some((value) => value.toLocaleLowerCase().includes(normalized))),
  )
}

const sourceLabel = (source: Source) => source === 'local' ? 'LOCAL' : 'NETEASE'
const kindLabel = (kind: Kind) => kind === 'song' ? '歌曲' : kind === 'album' ? '专辑' : '歌手'

function rowMarkup(item: SearchItem, index: number, selected: boolean) {
  return `<li class="search-result-row${selected ? ' is-selected' : ''}">
    <button type="button" class="search-result-select" data-search-select="${item.key}" aria-pressed="${selected}">
      <span class="search-result-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="search-result-title"><img src="${item.coverUrl}" alt="" loading="lazy" /><strong>${item.title}</strong></span>
      <span class="search-result-artist">${item.artist}</span><span class="search-result-album">${item.album}</span>
      <span><b class="search-source-tag" data-source="${item.source}">${sourceLabel(item.source)}</b></span>
      <time>${item.duration}</time>
    </button>
    <span class="search-result-actions"><button type="button" aria-label="播放 ${item.title}（演示阶段不可用）" disabled>▶</button><button type="button" aria-label="将 ${item.title} 加入队列（演示阶段不可用）" disabled>＋</button></span>
  </li>`
}

function selectedMarkup(item: SearchItem | undefined) {
  if (!item) return `<div class="search-empty-detail"><span>NO MATCH FOUND</span><p>没有找到匹配的演示档案。试试其他关键词或筛选条件。</p></div>`
  return `<div class="search-selected-cover"><img src="${item.coverUrl}" alt="${item.title} 的演示封面" /></div>
    <p class="search-selected-type">${kindLabel(item.kind)}档案 / DEMO RECORD</p>
    <h3>${item.title}</h3><p class="search-selected-artist">${item.artist}</p>
    <dl><div><dt>专辑</dt><dd>${item.album}</dd></div><div><dt>发行年份</dt><dd>${item.year}</dd></div>
      <div><dt>来源</dt><dd><b class="search-source-tag" data-source="${item.source}">${sourceLabel(item.source)}</b></dd></div>
      <div><dt>类型</dt><dd>${kindLabel(item.kind)}</dd></div><div><dt>时长</dt><dd>${item.duration}</dd></div></dl>
    <p class="search-selected-description">${item.description}</p>
    <div class="search-selected-actions"><button type="button" disabled>▶&nbsp;&nbsp;播放</button><button type="button" disabled>＋&nbsp;&nbsp;加入队列</button></div>`
}

export function createSearchPageMarkup() {
  return `<section class="search-page" data-search-page hidden inert aria-label="音乐检索">
    <div class="search-heading"><p>SEARCH / INDEX 001</p><h2>SEARCH <span>/</span> 音乐检索</h2><small>在演示音乐档案中查找歌曲、专辑与艺术家</small></div>
    <form class="search-input-line" data-search-form role="search"><label for="music-search" class="sr-only">搜索音乐</label>
      <input id="music-search" type="search" data-search-input placeholder="输入歌名、专辑或艺术家" autocomplete="off" spellcheck="false" />
      <button type="submit" aria-label="提交搜索">⌕</button><kbd>/</kbd></form>
    <div class="search-filters"><div role="group" aria-label="来源筛选"><span>来源</span>
      <button type="button" data-search-source="all" aria-pressed="true">全部</button>
      <button type="button" data-search-source="local" aria-pressed="false">本地音乐</button>
      <button type="button" data-search-source="netease" aria-pressed="false">网易云</button></div>
      <div role="group" aria-label="类型筛选"><span>类型</span>
      <button type="button" data-search-type="song" aria-pressed="true">歌曲</button>
      <button type="button" data-search-type="album" aria-pressed="false">专辑</button>
      <button type="button" data-search-type="artist" aria-pressed="false">歌手</button></div></div>
    <div class="search-content"><section class="search-results" aria-label="搜索结果">
      <div class="search-table-heading"><span>#</span><span>标题</span><span>歌手</span><span>专辑</span><span>来源</span><span>时长</span><span>操作</span></div>
      <div class="search-results-scroll"><ol data-search-results></ol><p class="search-empty" data-search-empty hidden>没有匹配的演示档案。换个关键词试试。</p></div>
      <p class="search-result-foot"><span data-search-count aria-live="polite"></span><span>STATIC PREVIEW · 暂未连接真实音源</span></p>
    </section></div><aside class="search-inspector" aria-label="当前选中结果">
      <header><span>当前选择</span><span data-search-position></span></header><div data-search-selected></div>
    </aside>
  </section>`
}

export function mountSearchPage(root: HTMLElement) {
  root.innerHTML = createSearchPageMarkup()
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const input = root.querySelector<HTMLInputElement>('[data-search-input]')!
  const results = root.querySelector<HTMLOListElement>('[data-search-results]')!
  const selected = root.querySelector<HTMLElement>('[data-search-selected]')!
  const empty = root.querySelector<HTMLElement>('[data-search-empty]')!
  let source: SourceFilter = 'all'
  let kind: Kind = 'song'
  let selectedKey = ''

  const render = () => {
    const matches = filterDemoSearchItems(input.value, source, kind)
    if (!matches.some((item) => item.key === selectedKey)) selectedKey = matches[0]?.key ?? ''
    results.innerHTML = matches.map((item, index) => rowMarkup(item, index, item.key === selectedKey)).join('')
    empty.hidden = matches.length !== 0
    selected.innerHTML = selectedMarkup(matches.find((item) => item.key === selectedKey))
    root.querySelector('[data-search-count]')!.textContent = `${String(matches.length).padStart(2, '0')} 条${kindLabel(kind)}演示结果`
    const position = matches.findIndex((item) => item.key === selectedKey) + 1
    root.querySelector('[data-search-position]')!.textContent = `${String(position).padStart(2, '0')} / ${String(matches.length).padStart(2, '0')}`
  }

  input.addEventListener('input', render, options)
  root.querySelector('[data-search-form]')?.addEventListener('submit', (event) => { event.preventDefault(); render() }, options)
  root.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const sourceButton = target.closest<HTMLButtonElement>('[data-search-source]')
    const typeButton = target.closest<HTMLButtonElement>('[data-search-type]')
    const rowButton = target.closest<HTMLButtonElement>('[data-search-select]')
    if (sourceButton) {
      source = sourceButton.dataset.searchSource as SourceFilter
      root.querySelectorAll('[data-search-source]').forEach((button) => button.setAttribute('aria-pressed', String(button === sourceButton)))
      render()
    } else if (typeButton) {
      kind = typeButton.dataset.searchType as Kind
      root.querySelectorAll('[data-search-type]').forEach((button) => button.setAttribute('aria-pressed', String(button === typeButton)))
      render()
    } else if (rowButton) {
      selectedKey = rowButton.dataset.searchSelect ?? ''
      render()
    }
  }, options)
  render()
  return { focus: () => input.focus(), clear: () => { input.value = ''; render() }, destroy: () => controller.abort() }
}
