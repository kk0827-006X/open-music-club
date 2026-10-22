import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Icon, IconButton } from '../../shared/react/ui.tsx'
import { usePageVisibility, useReducedMotion } from '../../shared/react/hooks.ts'
import {
  fetchLocalSearchItems,
  fetchNeteaseSearchItems,
  filterSearchItems,
  type SearchFetcher,
  type SearchItem,
  type SearchKind,
  type SearchSource,
  type SourceFilter,
} from '../../services/music/search.ts'

// 数据来源标签沿用旧页面的固定文案，转换逻辑仍完全交给服务层。
const sourceLabel = (source: SearchSource) => source === 'local' ? 'LOCAL' : 'NETEASE'
const kindLabel = (kind: SearchKind) => kind === 'song' ? '歌曲' : kind === 'album' ? '专辑' : '歌手'

// 延后到真正请求时再绑定 fetch，避免模块加载阶段依赖 window。
const browserFetcher = (): SearchFetcher => {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window) as SearchFetcher
  return (async () => { throw new Error('网络暂时不可用') }) as unknown as SearchFetcher
}

// 纯 React 视图：生产页面与 SSR 兼容入口 selectedMarkup() 共用这一份实现。
export function selectedDetail(item: SearchItem | undefined, onPlay: (item: SearchItem) => void, onQueue: (item: SearchItem) => void) {
  if (!item) {
    return <div className="search-empty-detail"><span>NO MATCH FOUND</span><p>请选择一条搜索结果查看资料。</p></div>
  }
  return (
    <>
      <div className="search-selected-cover"><img src={item.coverUrl} alt={`${item.title} 的封面`} /></div>
      <p className="search-selected-type">{kindLabel(item.kind)}档案 / MUSIC RECORD</p>
      <h3>{item.title}</h3>
      <p className="search-selected-artist">{item.artist}</p>
      <dl>
        <div><dt>专辑</dt><dd>{item.album}</dd></div>
        <div><dt>发行年份</dt><dd>{item.year}</dd></div>
        <div><dt>来源</dt><dd><b className="search-source-tag" data-source={item.source}>{sourceLabel(item.source)}</b></dd></div>
        <div><dt>类型</dt><dd>{kindLabel(item.kind)}</dd></div>
        <div><dt>时长</dt><dd>{item.duration}</dd></div>
      </dl>
      <p className="search-selected-description">{item.description}</p>
      <div className="search-selected-actions">
        <button type="button" data-search-play={item.key} disabled={item.kind !== 'song'} onClick={() => onPlay(item)}><Icon name="play" />&nbsp;&nbsp;播放</button>
        <button type="button" data-search-queue={item.key} disabled={item.kind !== 'song'} onClick={() => onQueue(item)}><Icon name="plus" />&nbsp;&nbsp;加入队列</button>
      </div>
    </>
  )
}

export interface SearchPageProps {
  active: boolean
  play?: (song: SearchItem) => Promise<unknown> | void
  enqueue?: (song: SearchItem) => void
  // 默认使用现有 fetchNeteaseSearchItems；保留注入口便于统一测试。
  load?: typeof fetchNeteaseSearchItems
  // 本地与网易云实际请求统一走这个 fetcher；缺省时才回落到 window.fetch。
  fetcher?: SearchFetcher
}

export interface SearchPageHandle {
  focus(): void
  refresh(): void
  ownsKeyboardTarget(target: EventTarget | null): boolean
}

export const SearchPage = forwardRef<SearchPageHandle, SearchPageProps>(function SearchPage(
  { active, play, enqueue, load = fetchNeteaseSearchItems, fetcher },
  ref,
) {
  const reduced = useReducedMotion()
  // 视觉淡出由共享 hook 延迟隐藏；业务上的 active=false 仍立即通过 inert 停止交互。
  const visible = usePageVisibility(active, 280)
  const inputRef = useRef<HTMLInputElement>(null)
  const localControllerRef = useRef<AbortController | null>(null)
  const localSerialRef = useRef(0)
  const neteaseControllerRef = useRef<AbortController | null>(null)
  const neteaseTimerRef = useRef<number | null>(null)
  const searchSerialRef = useRef(0)
  const actionSerialRef = useRef(0)
  const unmountedRef = useRef(false)
  const refreshRef = useRef<() => void>(() => undefined)

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [kind, setKind] = useState<SearchKind>('song')
  const [selectedKey, setSelectedKey] = useState('')
  const [localItems, setLocalItems] = useState<SearchItem[]>([])
  const [neteaseItems, setNeteaseItems] = useState<SearchItem[]>([])
  const [localError, setLocalError] = useState('')
  const [neteaseError, setNeteaseError] = useState('')
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [loadingNetease, setLoadingNetease] = useState(false)
  const [actionStatus, setActionStatus] = useState('')

  const matches = useMemo(
    () => filterSearchItems([...localItems, ...neteaseItems], query, source, kind),
    [localItems, neteaseItems, query, source, kind],
  )
  // 旧页在选中项被筛掉时会自动落到第一条，这里同步状态并保留同样行为。
  const selected = matches.find((item) => item.key === selectedKey) ?? matches[0]
  useEffect(() => {
    if (matches.some((item) => item.key === selectedKey)) return
    setSelectedKey(matches[0]?.key ?? '')
  }, [matches, selectedKey])
  const selectedPosition = selected ? matches.findIndex((item) => item.key === selected.key) + 1 : 0
  const emptyText = loadingLocal || loadingNetease
    ? '正在加载搜索结果…'
    : source === 'netease' && !query.trim()
      ? '输入关键词搜索网易云音乐。'
      : source === 'all' && !query.trim()
        ? '暂无本地音乐；输入关键词可以搜索网易云。'
        : '没有匹配的音乐。换个关键词或筛选条件试试。'
  const derivedStatus = [
    localError && source !== 'netease' ? localError : '',
    neteaseError && source !== 'local' ? neteaseError : '',
    loadingNetease ? '正在检索网易云…' : '',
  ].filter(Boolean).join(' · ')
  const statusText = actionStatus || derivedStatus || '选择歌曲即可播放'

  const refresh = () => {
    if (unmountedRef.current) return
    // 新的操作会让此前异步播放/搜索状态失效，避免旧响应覆盖当前提示。
    const statusSerial = ++actionSerialRef.current
    localControllerRef.current?.abort()
    const controller = new AbortController()
    localControllerRef.current = controller
    const serial = ++localSerialRef.current
    setActionStatus('')
    setLocalItems([])
    setLoadingLocal(true)
    setLocalError('')
    void fetchLocalSearchItems(fetcher ?? browserFetcher(), controller.signal).then((items) => {
      if (unmountedRef.current || serial !== localSerialRef.current || controller.signal.aborted) return
      setLocalItems(items)
      setLoadingLocal(false)
      if (statusSerial === actionSerialRef.current) setActionStatus('')
    }).catch((error: unknown) => {
      if (unmountedRef.current || serial !== localSerialRef.current || controller.signal.aborted) return
      setLocalError(error instanceof Error && error.message === '登录已失效，请重新登录' ? error.message : '本地音乐暂时无法加载')
      setLoadingLocal(false)
      if (statusSerial === actionSerialRef.current) setActionStatus('')
    })
  }
  refreshRef.current = refresh

  const searchNetease = (queryValue: string, kindValue: SearchKind, sourceValue: SourceFilter, immediate = false) => {
    const statusSerial = ++actionSerialRef.current
    searchSerialRef.current += 1
    const serial = searchSerialRef.current
    if (neteaseTimerRef.current !== null) window.clearTimeout(neteaseTimerRef.current)
    neteaseTimerRef.current = null
    neteaseControllerRef.current?.abort()
    neteaseControllerRef.current = null
    setActionStatus('')
    setNeteaseItems([])
    setNeteaseError('')
    // 本地来源或空关键词不需要请求网易云，但保留当前类型筛选。
    if (sourceValue === 'local' || !queryValue.trim()) {
      setLoadingNetease(false)
      return
    }
    setLoadingNetease(true)
    neteaseTimerRef.current = window.setTimeout(() => {
      neteaseTimerRef.current = null
      if (unmountedRef.current) return
      const controller = new AbortController()
      neteaseControllerRef.current = controller
      void load(queryValue, kindValue, fetcher ?? browserFetcher(), controller.signal).then((items) => {
        if (unmountedRef.current || serial !== searchSerialRef.current || controller.signal.aborted) return
        setNeteaseItems(items)
        setLoadingNetease(false)
        if (statusSerial === actionSerialRef.current) setActionStatus('')
      }).catch((error: unknown) => {
        if (unmountedRef.current || serial !== searchSerialRef.current || controller.signal.aborted) return
        setNeteaseError(error instanceof Error && error.message === '登录已失效，请重新登录' ? error.message : '网易云搜索暂时不可用')
        setLoadingNetease(false)
        if (statusSerial === actionSerialRef.current) setActionStatus('')
      })
    }, immediate ? 0 : 280)
  }

  const playItem = async (item: SearchItem | undefined) => {
    if (!item || item.kind !== 'song') return
    // 连续点击播放时只允许最后一次异步结果更新状态。
    const serial = ++actionSerialRef.current
    setActionStatus('正在获取播放地址…')
    try {
      await Promise.resolve().then(() => play?.(item))
      if (unmountedRef.current || serial !== actionSerialRef.current) return
      setActionStatus('正在播放')
    } catch (error) {
      if (unmountedRef.current || serial !== actionSerialRef.current) return
      setActionStatus(error instanceof Error && ['歌曲暂不可播放', '登录已失效，请重新登录'].includes(error.message)
        ? error.message
        : '歌曲暂不可播放')
    }
  }

  const queueItem = (item: SearchItem | undefined) => {
    if (!item || item.kind !== 'song') return
    actionSerialRef.current += 1
    enqueue?.(item)
    setActionStatus('已加入播放队列')
  }

  const onSourceClick = (next: SourceFilter) => {
    setSource(next)
    searchNetease(query, kind, next, true)
  }
  const onKindClick = (next: SearchKind) => {
    setKind(next)
    searchNetease(query, next, source, true)
  }
  const onQueryInput = (value: string) => {
    setQuery(value)
    searchNetease(value, kind, source)
  }

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      // 卸载时同时让序列号失效，避免任何异步回调再写状态。
      unmountedRef.current = true
      actionSerialRef.current += 1
      localSerialRef.current += 1
      searchSerialRef.current += 1
      localControllerRef.current?.abort()
      neteaseControllerRef.current?.abort()
      if (neteaseTimerRef.current !== null) window.clearTimeout(neteaseTimerRef.current)
      neteaseTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    // 首次 active 由 App 懒挂载；之后每次重新激活都按旧导航行为刷新本地音乐。
    if (active) refreshRef.current()
  }, [active])

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    refresh: () => refreshRef.current(),
    ownsKeyboardTarget: (target: EventTarget | null) => target === inputRef.current,
  }), [])

  return (
    <motion.section
      className="search-page"
      data-search-page
      hidden={!visible}
      inert={!active}
      aria-label="音乐检索"
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={reduced ? { duration: 0 } : { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] }}
    >
      <div className="search-heading"><p>SEARCH / INDEX 001</p><h2>SEARCH <span>/</span> 音乐检索</h2><small>检索社区音乐与网易云的歌曲、专辑和歌手</small></div>
      <form className="search-input-line" data-search-form role="search" onSubmit={(event) => { event.preventDefault(); searchNetease(query, kind, source, true) }}>
        <label htmlFor="music-search" className="sr-only">搜索音乐</label>
        <input
          id="music-search"
          ref={inputRef}
          type="search"
          data-search-input
          placeholder="输入歌名、专辑或艺术家"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryInput(event.currentTarget.value)}
        />
        <button type="submit" aria-label="提交搜索"><Icon name="search" /></button><kbd>/</kbd>
      </form>
      <div className="search-filters">
        <div role="group" aria-label="来源筛选"><span>来源</span>
          <button type="button" data-search-source="all" aria-pressed={source === 'all'} onClick={() => onSourceClick('all')}>全部</button>
          <button type="button" data-search-source="local" aria-pressed={source === 'local'} onClick={() => onSourceClick('local')}>本地音乐</button>
          <button type="button" data-search-source="netease" aria-pressed={source === 'netease'} onClick={() => onSourceClick('netease')}>网易云</button>
        </div>
        <div role="group" aria-label="类型筛选"><span>类型</span>
          <button type="button" data-search-type="song" aria-pressed={kind === 'song'} onClick={() => onKindClick('song')}>歌曲</button>
          <button type="button" data-search-type="album" aria-pressed={kind === 'album'} onClick={() => onKindClick('album')}>专辑</button>
          <button type="button" data-search-type="artist" aria-pressed={kind === 'artist'} onClick={() => onKindClick('artist')}>歌手</button>
        </div>
      </div>
      <div className="search-content"><section className="search-results" aria-label="搜索结果">
        <div className="search-table-heading"><span>#</span><span>标题</span><span>歌手</span><span>专辑</span><span>来源</span><span>时长</span><span>操作</span></div>
        <div className="search-results-scroll">
          <ol data-search-results>
            {matches.map((item, index) => {
              const isSelected = selected?.key === item.key
              return (
                <li key={item.key} className={`search-result-row${isSelected ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className="search-result-select"
                    data-search-select={item.key}
                    aria-pressed={isSelected}
                    onClick={() => { actionSerialRef.current += 1; setSelectedKey(item.key); setActionStatus('') }}
                  >
                    <span className="search-result-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="search-result-title"><img src={item.coverUrl} alt="" loading="lazy" /><strong>{item.title}</strong></span>
                    <span className="search-result-artist">{item.artist}</span><span className="search-result-album">{item.album}</span>
                    <span><b className="search-source-tag" data-source={item.source}>{sourceLabel(item.source)}</b></span>
                    <time>{item.duration}</time>
                  </button>
                  <span className="search-result-actions">
                    <IconButton icon="play" data-search-play={item.key} aria-label={`播放 ${item.title}`} disabled={item.kind !== 'song'} onClick={() => void playItem(item)} />
                    <IconButton icon="plus" data-search-queue={item.key} aria-label={`将 ${item.title} 加入队列`} disabled={item.kind !== 'song'} onClick={() => queueItem(item)} />
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="search-empty" data-search-empty hidden={matches.length !== 0}>{emptyText}</p>
        </div>
        <p className="search-result-foot"><span data-search-count aria-live="polite">{String(matches.length).padStart(2, '0')} 条{kindLabel(kind)}结果</span><span data-search-status role="status">{statusText}</span></p>
      </section></div>
      <aside className="search-inspector" aria-label="当前选中结果">
        <header><span>当前选择</span><span data-search-position>{String(selectedPosition).padStart(2, '0')} / {String(matches.length).padStart(2, '0')}</span></header>
        <div data-search-selected>{selectedDetail(selected, (item) => void playItem(item), queueItem)}</div>
      </aside>
    </motion.section>
  )
})

export default SearchPage
