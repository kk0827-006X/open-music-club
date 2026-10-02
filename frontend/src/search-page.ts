import { uiIcons } from './ui-icons.ts'
import {
  fetchLocalSearchItems,
  fetchNeteaseSearchItems,
  filterSearchItems,
  type SearchFetcher,
  type SearchItem,
  type SearchKind,
  type SearchSource,
  type SourceFilter,
} from './music-search.ts'

const sourceLabel = (source: SearchSource) => source === 'local' ? 'LOCAL' : 'NETEASE'
const kindLabel = (kind: SearchKind) => kind === 'song' ? '歌曲' : kind === 'album' ? '专辑' : '歌手'
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

function rowMarkup(item: SearchItem, index: number, selected: boolean) {
  const title = escapeHtml(item.title)
  return `<li class="search-result-row${selected ? ' is-selected' : ''}">
    <button type="button" class="search-result-select" data-search-select="${escapeHtml(item.key)}" aria-pressed="${selected}">
      <span class="search-result-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="search-result-title"><img src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" /><strong>${title}</strong></span>
      <span class="search-result-artist">${escapeHtml(item.artist)}</span><span class="search-result-album">${escapeHtml(item.album)}</span>
      <span><b class="search-source-tag" data-source="${item.source}">${sourceLabel(item.source)}</b></span>
      <time>${escapeHtml(item.duration)}</time>
    </button>
    <span class="search-result-actions"><button type="button" data-search-play="${escapeHtml(item.key)}" aria-label="播放 ${title}"${item.kind === 'song' ? '' : ' disabled'}>${uiIcons.play}</button><button type="button" data-search-queue="${escapeHtml(item.key)}" aria-label="将 ${title} 加入队列"${item.kind === 'song' ? '' : ' disabled'}>${uiIcons.plus}</button></span>
  </li>`
}

export function selectedMarkup(item: SearchItem | undefined) {
  if (!item) return `<div class="search-empty-detail"><span>NO MATCH FOUND</span><p>请选择一条搜索结果查看资料。</p></div>`
  return `<div class="search-selected-cover"><img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} 的封面" /></div>
    <p class="search-selected-type">${kindLabel(item.kind)}档案 / MUSIC RECORD</p>
    <h3>${escapeHtml(item.title)}</h3><p class="search-selected-artist">${escapeHtml(item.artist)}</p>
    <dl><div><dt>专辑</dt><dd>${escapeHtml(item.album)}</dd></div><div><dt>发行年份</dt><dd>${escapeHtml(item.year)}</dd></div>
      <div><dt>来源</dt><dd><b class="search-source-tag" data-source="${item.source}">${sourceLabel(item.source)}</b></dd></div>
      <div><dt>类型</dt><dd>${kindLabel(item.kind)}</dd></div><div><dt>时长</dt><dd>${escapeHtml(item.duration)}</dd></div></dl>
    <p class="search-selected-description">${escapeHtml(item.description)}</p>
    <div class="search-selected-actions"><button type="button" data-search-play="${escapeHtml(item.key)}"${item.kind === 'song' ? '' : ' disabled'}>${uiIcons.play}&nbsp;&nbsp;播放</button><button type="button" data-search-queue="${escapeHtml(item.key)}"${item.kind === 'song' ? '' : ' disabled'}>${uiIcons.plus}&nbsp;&nbsp;加入队列</button></div>`
}

export function createSearchPageMarkup() {
  return `<section class="search-page" data-search-page hidden inert aria-label="音乐检索">
    <div class="search-heading"><p>SEARCH / INDEX 001</p><h2>SEARCH <span>/</span> 音乐检索</h2><small>检索社区音乐与网易云的歌曲、专辑和歌手</small></div>
    <form class="search-input-line" data-search-form role="search"><label for="music-search" class="sr-only">搜索音乐</label>
      <input id="music-search" type="search" data-search-input placeholder="输入歌名、专辑或艺术家" autocomplete="off" spellcheck="false" />
      <button type="submit" aria-label="提交搜索">${uiIcons.search}</button><kbd>/</kbd></form>
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
      <div class="search-results-scroll"><ol data-search-results></ol><p class="search-empty" data-search-empty hidden>没有匹配的音乐。换个关键词试试。</p></div>
      <p class="search-result-foot"><span data-search-count aria-live="polite"></span><span data-search-status role="status">选择歌曲即可播放</span></p>
    </section></div><aside class="search-inspector" aria-label="当前选中结果">
      <header><span>当前选择</span><span data-search-position></span></header><div data-search-selected></div>
    </aside>
  </section>`
}

export function mountSearchPage(root: HTMLElement, onPlay: (item: SearchItem) => Promise<void> | void = () => undefined, fetcher: SearchFetcher = window.fetch.bind(window) as SearchFetcher, onQueue: (item: SearchItem) => void = () => undefined) {
  root.innerHTML = createSearchPageMarkup()
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const input = root.querySelector<HTMLInputElement>('[data-search-input]')!
  const results = root.querySelector<HTMLOListElement>('[data-search-results]')!
  const selected = root.querySelector<HTMLElement>('[data-search-selected]')!
  const empty = root.querySelector<HTMLElement>('[data-search-empty]')!
  const status = root.querySelector<HTMLElement>('[data-search-status]')!
  let source: SourceFilter = 'all'
  let kind: SearchKind = 'song'
  let selectedKey = ''
  let localItems: SearchItem[] = []
  let neteaseItems: SearchItem[] = []
  let localError = ''
  let neteaseError = ''
  let loadingLocal = true
  let loadingNetease = false
  let localController: AbortController | null = null
  let neteaseController: AbortController | null = null
  let neteaseTimer = 0
  let searchSerial = 0

  const render = () => {
    const matches = filterSearchItems([...localItems, ...neteaseItems], input.value, source, kind)
    if (!matches.some((item) => item.key === selectedKey)) selectedKey = matches[0]?.key ?? ''
    results.innerHTML = matches.map((item, index) => rowMarkup(item, index, item.key === selectedKey)).join('')
    empty.hidden = matches.length !== 0
    if (!matches.length) empty.textContent = loadingLocal || loadingNetease
      ? '正在加载搜索结果…'
      : source === 'netease' && !input.value.trim()
        ? '输入关键词搜索网易云音乐。'
        : source === 'all' && !input.value.trim()
          ? '暂无本地音乐；输入关键词可以搜索网易云。'
          : '没有匹配的音乐。换个关键词或筛选条件试试。'
    selected.innerHTML = selectedMarkup(matches.find((item) => item.key === selectedKey))
    root.querySelector('[data-search-count]')!.textContent = `${String(matches.length).padStart(2, '0')} 条${kindLabel(kind)}结果`
    const position = matches.findIndex((item) => item.key === selectedKey) + 1
    root.querySelector('[data-search-position]')!.textContent = `${String(position).padStart(2, '0')} / ${String(matches.length).padStart(2, '0')}`
    status.textContent = [localError && source !== 'netease' ? localError : '', neteaseError && source !== 'local' ? neteaseError : '', loadingNetease ? '正在检索网易云…' : ''].filter(Boolean).join(' · ') || '选择歌曲即可播放'
  }

  const searchNetease = (immediate = false) => {
    searchSerial += 1
    const serial = searchSerial
    window.clearTimeout(neteaseTimer)
    neteaseController?.abort()
    neteaseItems = []
    neteaseError = ''
    if (source === 'local' || !input.value.trim()) {
      loadingNetease = false
      render()
      return
    }
    loadingNetease = true
    render()
    neteaseTimer = window.setTimeout(() => {
      const currentController = new AbortController()
      neteaseController = currentController
      void fetchNeteaseSearchItems(input.value, kind, fetcher, currentController.signal).then((items) => {
        if (serial !== searchSerial || controller.signal.aborted) return
        neteaseItems = items
        loadingNetease = false
        render()
      }).catch((error: unknown) => {
        if (serial !== searchSerial || currentController.signal.aborted || controller.signal.aborted) return
        neteaseError = error instanceof Error && error.message === '登录已失效，请重新登录' ? error.message : '网易云搜索暂时不可用'
        loadingNetease = false
        render()
      })
    }, immediate ? 0 : 280)
  }

  const refresh = () => {
    localController?.abort()
    const currentController = new AbortController()
    localController = currentController
    localItems = []
    loadingLocal = true
    localError = ''
    render()
    void fetchLocalSearchItems(fetcher, currentController.signal).then((items) => {
      if (currentController.signal.aborted || controller.signal.aborted) return
      localItems = items
      loadingLocal = false
      render()
    }).catch((error: unknown) => {
      if (currentController.signal.aborted || controller.signal.aborted) return
      localError = error instanceof Error && error.message === '登录已失效，请重新登录' ? error.message : '本地音乐暂时无法加载'
      loadingLocal = false
      render()
    })
  }

  input.addEventListener('input', () => searchNetease(), options)
  root.querySelector('[data-search-form]')?.addEventListener('submit', (event) => { event.preventDefault(); searchNetease(true) }, options)
  root.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const sourceButton = target.closest<HTMLButtonElement>('[data-search-source]')
    const typeButton = target.closest<HTMLButtonElement>('[data-search-type]')
    const rowButton = target.closest<HTMLButtonElement>('[data-search-select]')
    const playButton = target.closest<HTMLButtonElement>('[data-search-play]')
    const queueButton = target.closest<HTMLButtonElement>('[data-search-queue]')
    if (sourceButton) {
      source = sourceButton.dataset.searchSource as SourceFilter
      root.querySelectorAll('[data-search-source]').forEach((button) => button.setAttribute('aria-pressed', String(button === sourceButton)))
      searchNetease(true)
    } else if (typeButton) {
      kind = typeButton.dataset.searchType as SearchKind
      root.querySelectorAll('[data-search-type]').forEach((button) => button.setAttribute('aria-pressed', String(button === typeButton)))
      searchNetease(true)
    } else if (queueButton && !queueButton.disabled) {
      const item = filterSearchItems([...localItems, ...neteaseItems], input.value, source, kind)
        .find((entry) => entry.key === queueButton.dataset.searchQueue)
      if (item?.kind === 'song') { onQueue(item); status.textContent = '已加入播放队列' }
    } else if (playButton && !playButton.disabled) {
      const item = filterSearchItems([...localItems, ...neteaseItems], input.value, source, kind)
        .find((entry) => entry.key === playButton.dataset.searchPlay)
      if (!item || item.kind !== 'song') return
      status.textContent = '正在获取播放地址…'
      void Promise.resolve().then(() => onPlay(item)).then(() => {
        status.textContent = '正在播放'
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error && ['歌曲暂不可播放', '登录已失效，请重新登录'].includes(error.message)
          ? error.message : '歌曲暂不可播放'
      })
    } else if (rowButton) {
      selectedKey = rowButton.dataset.searchSelect ?? ''
      render()
    }
  }, options)
  render()
  refresh()
  return {
    focus: () => input.focus(),
    refresh,
    destroy: () => {
      controller.abort()
      localController?.abort()
      neteaseController?.abort()
      window.clearTimeout(neteaseTimer)
    },
  }
}
