import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../shared/react/ui.tsx'
import { usePageVisibility, useReducedMotion } from '../../shared/react/hooks.ts'
import type { SearchItem } from '../../shared/music.ts'
import {
  createBlindBoxClient,
  toBlindBoxSong,
  type BlindBox,
  type BlindBoxClient,
  type BlindBoxStyle,
  type BlindBoxSummary,
  type BlindBoxTrack,
  type RankingEntry,
  type RankingMetric,
} from '../../services/music/blind-box.ts'

const COUNT_OPTIONS = [1, 3, 5] as const
// 首屏先用静态风格表渲染，接口返回后再用服务端标签与曲库数量覆盖。
const STYLE_CHIPS: BlindBoxStyle[] = [
  { key: 'all', label: '全部', count: 0 },
  { key: 'pop', label: '流行', count: 0 },
  { key: 'jazz', label: '爵士', count: 0 },
  { key: 'rock', label: '摇滚', count: 0 },
  { key: 'electronic', label: '电子', count: 0 },
  { key: 'folk', label: '民谣', count: 0 },
  { key: 'classical', label: '古典', count: 0 },
  { key: 'hiphop', label: '说唱', count: 0 },
  { key: 'rnb', label: 'R&B', count: 0 },
  { key: 'other', label: '综合', count: 0 },
]
const REEL_TOKENS = ['ALBUM', 'ARTIST', 'STYLE', 'BPM', 'MOOD', 'SIDE A', 'VINYL', 'TRACK']
const FALLBACK_COVER = '/images/album-placeholder-01.svg'

function two(value: number) {
  return String(value).padStart(2, '0')
}

// SQLite 时间戳是 "YYYY-MM-DD HH:MM:SS"（UTC），只用于列表展示，失败时退回原文。
export function formatStamp(value: string | undefined): string {
  if (!value) return '—'
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return `${two(date.getMonth() + 1)}.${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export interface BlindBoxPageProps {
  active?: boolean
  play?: (song: SearchItem) => Promise<unknown> | void
  enqueue?: (song: SearchItem) => void
  client?: BlindBoxClient
  onNavigateUpload?: () => void
}

export interface BlindBoxPageHandle {
  refresh(): void
}

export const BlindBoxPage = forwardRef<BlindBoxPageHandle, BlindBoxPageProps>(function BlindBoxPage(
  { active = true, play, enqueue, client: injectedClient, onNavigateUpload },
  ref,
) {
  // 淡出交给共享 hook；数据只在挂载后拉取一次，重新进入页面不重复请求。
  const visible = usePageVisibility(active, 280)
  const reduced = useReducedMotion()
  const client = useMemo(() => injectedClient ?? createBlindBoxClient(), [injectedClient])
  const [styles, setStyles] = useState<BlindBoxStyle[]>(() => STYLE_CHIPS.map((style) => ({ ...style })))
  const [stylesLoaded, setStylesLoaded] = useState(false)
  const [style, setStyle] = useState('pop')
  const [count, setCount] = useState(3)
  const [box, setBox] = useState<BlindBox | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [hint, setHint] = useState('')
  const [uploadHint, setUploadHint] = useState(false)
  const [tab, setTab] = useState<'favorites' | 'ranking'>('favorites')
  const [metric, setMetric] = useState<RankingMetric>('favorite')
  const [favorites, setFavorites] = useState<BlindBoxSummary[]>([])
  const [favoritesTotal, setFavoritesTotal] = useState(0)
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [poolTotal, setPoolTotal] = useState<number | null>(null)
  const serialRef = useRef(0)
  const disposedRef = useRef(false)

  const styleLabel = useCallback((key: string) =>
    styles.find((entry) => entry.key === key)?.label ?? '综合', [styles])

  // 榜单请求序号：只有仍对应当前筛选的最新响应才能写入，迟到的旧结果直接丢弃。
  const rankingSerialRef = useRef(0)
  // tab 用 ref 读取，避免过期闭包里旧 tab 判断出错。
  const tabRef = useRef(tab)

  useEffect(() => { tabRef.current = tab }, [tab])

  const loadRanking = useCallback(async (nextStyle: string, nextMetric: RankingMetric) => {
    const serial = ++rankingSerialRef.current
    try {
      const data = await client.ranking(nextMetric, nextStyle)
      if (disposedRef.current || serial !== rankingSerialRef.current) return
      setRanking(data.entries)
    } catch (error) {
      if (disposedRef.current || serial !== rankingSerialRef.current) return
      // 榜单失败只影响榜单面板：用户已切回收藏列表时，不得覆盖收藏内容或状态文案。
      if (tabRef.current === 'ranking') {
        setStatus(error instanceof Error ? error.message : '榜单读取失败，请稍后刷新')
      }
    }
  }, [client])

  const loadFavorites = useCallback(async () => {
    try {
      const data = await client.favorites()
      if (disposedRef.current) return
      setFavorites(data.boxes)
      setFavoritesTotal(data.total)
    } catch {
      /* 收藏列表失败不打断页面，保持空态 */
    }
  }, [client])

  useEffect(() => {
    disposedRef.current = false
    void (async () => {
      try {
        const data = await client.styles()
        if (disposedRef.current) return
        setStyles(data.styles.length ? data.styles : styles)
        setStylesLoaded(true)
        setPoolTotal(data.total)
      } catch (error) {
        if (disposedRef.current) return
        setPoolTotal(null)
        setStatus(error instanceof Error ? error.message : '曲库读取失败')
      }
    })()
    void loadFavorites()
    return () => { disposedRef.current = true; serialRef.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // 抽取中的老虎机字牌：reduced-motion 用户保持静止。
  const [reels, setReels] = useState<string[]>(() => REEL_TOKENS.slice(0, 4))
  useEffect(() => {
    if (!busy || reduced) return
    setReels(REEL_TOKENS.slice(0, 4))
    const ticker = window.setInterval(() => {
      setReels(Array.from({ length: 4 }, () => REEL_TOKENS[Math.floor(Math.random() * REEL_TOKENS.length)]))
    }, 90)
    return () => window.clearInterval(ticker)
  }, [busy, reduced])

  const draw = useCallback(async () => {
    if (busy) return
    const current = ++serialRef.current
    setBusy(true)
    setStatus('正在抽取…')
    setHint('')
    setUploadHint(false)
    const startedAt = Date.now()
    try {
      const next = await client.draw(style, count)
      if (disposedRef.current || current !== serialRef.current) return
      // 动效至少留出可感知的时长，但没有结果时不做无意义等待。
      const remaining = reduced ? 0 : Math.max(0, 620 - (Date.now() - startedAt))
      if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
      if (disposedRef.current || current !== serialRef.current) return
      setBox(next)
      setBusy(false)
      setStatus(`已抽到 ${next.tracks.length} 首 · 风格「${next.styleLabel}」`)
      void loadRanking(style, metric)
    } catch (error) {
      if (disposedRef.current || current !== serialRef.current) return
      setBusy(false)
      setBox(null)
      const message = error instanceof Error ? error.message : '抽取失败，请稍后重试'
      setStatus(message)
      setHint(message)
      setUploadHint(Boolean(onNavigateUpload))
    }
  }, [busy, client, style, count, reduced, loadRanking, metric, onNavigateUpload])

  const toggleFavorite = useCallback(async (id: number, next: boolean) => {
    try {
      const updated = next ? await client.favorite(id) : await client.unfavorite(id)
      if (disposedRef.current) return
      setBox((previous) => previous?.id === updated.id ? updated : previous)
      setStatus(next ? '已收藏这个盲盒' : '已取消收藏')
      await Promise.all([loadFavorites(), loadRanking(style, metric)])
    } catch (error) {
      if (disposedRef.current) return
      setStatus(error instanceof Error ? error.message : '收藏失败，请稍后重试')
    }
  }, [client, loadFavorites, loadRanking, style, metric])

  const openBox = useCallback(async (id: number) => {
    try {
      const opened = await client.box(id)
      if (disposedRef.current) return
      setBox(opened)
      setStatus(`已打开收藏的盲盒 #${id}`)
    } catch (error) {
      if (disposedRef.current) return
      setStatus(error instanceof Error ? error.message : '打开失败，请稍后重试')
    }
  }, [client])

  const playTrack = useCallback(async (track: BlindBoxTrack) => {
    if (!play) return
    setStatus('正在获取播放地址…')
    try {
      await play(toBlindBoxSong(track))
      setStatus('正在播放')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '歌曲暂不可播放')
    }
  }, [play])

  const queueAll = useCallback(() => {
    if (!box || !enqueue) return
    box.tracks.forEach((track) => enqueue(toBlindBoxSong(track)))
    setStatus(`已把 ${box.tracks.length} 首加入播放队列`)
  }, [box, enqueue])

  useImperativeHandle(ref, () => ({
    refresh() {
      if (disposedRef.current) return
      void client.styles().then((data) => {
        if (disposedRef.current) return
        setStyles(data.styles.length ? data.styles : styles)
        setPoolTotal(data.total)
      }).catch(() => undefined)
      void loadFavorites()
      void loadRanking(style, metric)
    },
  }))

  const switchStyle = useCallback((next: string) => {
    setStyle(next)
    setStatus(`已切换到「${styleLabel(next)}」`)
    // 筛选变化即刷新榜单：切回榜单面板时数据一定与当前筛选一致，不会出现页脚与列表错位。
    void loadRanking(next, metric)
  }, [styleLabel, metric, loadRanking])

  const switchMetric = useCallback((next: RankingMetric) => {
    setMetric(next)
    void loadRanking(style, next)
  }, [style, loadRanking])

  return (
    <section className="blind-box-page" data-blind-box-page hidden={!visible} inert={!active} aria-label="音乐盲盒">
      <header className="blind-box-heading">
        <p>BLIND BOX / RANDOM DRAW 001</p>
        <h2>BLIND BOX <span>/</span> 音乐盲盒</h2>
        <small>不知道听什么的时候，选一个风格，让系统替你从曲库里抽一箱。</small>
      </header>
      <div className="blind-box-controls">
        <div className="blind-box-styles" role="group" aria-label="风格筛选" data-blind-box-styles>
          {styles.map((entry, index) => (
            <button key={entry.key} type="button" data-blind-box-style={entry.key}
              aria-pressed={entry.key === style} onClick={() => switchStyle(entry.key)}>
              <i>{two(index + 1)}</i>{entry.label}<b data-style-count={entry.key}>{stylesLoaded ? entry.count : '—'}</b>
            </button>
          ))}
        </div>
        <div className="blind-box-count" role="group" aria-label="每箱歌曲数量"><span>每箱</span>
          {COUNT_OPTIONS.map((value) => (
            <button key={value} type="button" data-blind-box-count={value}
              aria-pressed={value === count} onClick={() => setCount(value)}>{value}</button>
          ))}
          <span>首</span>
        </div>
      </div>
      <section className={`blind-box-stage${busy ? ' is-busy' : ''}`} data-blind-box-stage aria-label="抽取区">
        {!box && !busy && (
          <div className="blind-box-stage-idle" data-blind-box-idle>
            <p className="blind-box-kicker">READY TO DRAW</p>
            <div className="blind-box-reels" aria-hidden="true">
              {['ALBUM', 'ARTIST', 'STYLE', 'VINYL'].map((token) => <span key={token} data-reel>{token}</span>)}
            </div>
            <p className="blind-box-hint" data-blind-box-hint>
              {hint
                ? <>{hint}{uploadHint && <button type="button" className="blind-box-inline-link" data-blind-box-upload onClick={onNavigateUpload}>去上传音乐</button>}</>
                : <>当前风格「{styleLabel(style)}」，点一下抽取，系统会随机取出 {count} 首。</>}
            </p>
            <button type="button" className="blind-box-draw" data-blind-box-draw onClick={() => void draw()}>
              <Icon name="play" /><span>抽取盲盒</span><i>PRESS / DRAW</i>
            </button>
          </div>
        )}
        {busy && (
          <div className="blind-box-stage-drawing" data-blind-box-drawing>
            <div className="blind-box-reels" aria-hidden="true">
              {reels.map((token, index) => <span key={`${token}-${index}`} data-reel>{token}</span>)}
            </div>
            <p>正在从曲库里抽取…</p>
          </div>
        )}
        {box && !busy && (
          <div className="blind-box-stage-result" data-blind-box-result aria-live="polite">
            <div className="blind-box-result-head">
              <p>BOX #{two(box.id)} / {box.styleLabel}</p>
              <strong>本次抽到 {box.tracks.length} 首</strong>
              <span>{formatStamp(box.createdAt)}</span>
            </div>
            <div className="blind-box-cards">
              {box.tracks.map((track, index) => (
                <article key={track.key} className="blind-box-card is-revealed" data-blind-box-card={track.key} style={{ '--card-delay': `${index * 70}ms` } as CSSProperties}>
                  <div className="blind-box-card-cover">
                    <img src={track.coverUrl || FALLBACK_COVER} alt={`${track.title} 封面`} loading="lazy" />
                    <b>{two(index + 1)}</b>
                  </div>
                  <p className="blind-box-card-style"><i data-style={track.style}>{track.styleLabel}</i><time>{track.duration}</time></p>
                  <h3>{track.title}</h3>
                  <p className="blind-box-card-artist">{track.artist}<span>{track.album}</span></p>
                  <div className="blind-box-card-actions">
                    <button type="button" data-blind-box-play={track.key} aria-label={`播放 ${track.title}`} onClick={() => void playTrack(track)}>
                      <Icon name="play" /><span>播放</span>
                    </button>
                    <button type="button" data-blind-box-enqueue={track.key} aria-label={`将 ${track.title} 加入队列`}
                      onClick={() => { if (enqueue) { enqueue(toBlindBoxSong(track)); setStatus(`已加入队列：${track.title}`) } }}>
                      <Icon name="plus" /><span>队列</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className="blind-box-actions" data-blind-box-actions hidden={!box}>
        <button type="button" data-blind-box-again onClick={() => void draw()}><Icon name="dice" /><span>再抽一箱</span></button>
        <button type="button" data-blind-box-queue-all onClick={queueAll}><Icon name="plus" /><span>全部入队</span></button>
        <button type="button" data-blind-box-save aria-pressed={Boolean(box?.favorited)}
          onClick={() => { if (box) void toggleFavorite(box.id, !box.favorited) }}>
          <Icon name="heart" /><span>{box?.favorited ? '已收藏' : '收藏这个盲盒'}</span>
        </button>
        <p data-blind-box-status role="status">{status}</p>
      </div>
      <aside className="blind-box-panel" aria-label="盲盒收藏与榜单">
        <div className="blind-box-tabs" role="tablist" aria-label="盲盒面板">
          <button type="button" role="tab" data-blind-box-tab="favorites" aria-selected={tab === 'favorites'}
            onClick={() => setTab('favorites')}>我的盲盒</button>
          <button type="button" role="tab" data-blind-box-tab="ranking" aria-selected={tab === 'ranking'}
            onClick={() => { setTab('ranking'); void loadRanking(style, metric) }}>盲盒榜单</button>
        </div>
        <div className="blind-box-metric" role="group" aria-label="榜单排序" data-blind-box-metric-bar hidden={tab !== 'ranking'}>
          <button type="button" data-blind-box-metric="favorite" aria-pressed={metric === 'favorite'} onClick={() => switchMetric('favorite')}>被收藏</button>
          <button type="button" data-blind-box-metric="draw" aria-pressed={metric === 'draw'} onClick={() => switchMetric('draw')}>被抽取</button>
        </div>
        <div className="blind-box-panel-body" data-blind-box-panel-body>
          {tab === 'favorites' ? (
            favorites.length ? (
              <ol className="blind-box-favorites">
                {favorites.map((favorite, index) => (
                  <li key={favorite.id}>
                    <button type="button" className="blind-box-favorite-open" data-blind-box-open={favorite.id}
                      aria-label={`打开第 ${index + 1} 个收藏盲盒`} onClick={() => void openBox(favorite.id)}>
                      <span className="blind-box-favorite-index">{two(index + 1)}</span>
                      <span className="blind-box-favorite-covers">
                        {(favorite.covers.length ? favorite.covers : [FALLBACK_COVER]).slice(0, 3).map((cover, coverIndex) => (
                          <img key={`${favorite.id}-${coverIndex}`} src={cover} alt="" loading="lazy" />
                        ))}
                      </span>
                      <span className="blind-box-favorite-copy">
                        <b>{favorite.styleLabel} · {favorite.trackCount} 首</b>
                        <small>{favorite.titles[0] || '—'}{favorite.trackCount > 1 ? ' 等' : ''}</small>
                      </span>
                      <time>{formatStamp(favorite.favoritedAt)}</time>
                    </button>
                    <button type="button" className="blind-box-favorite-remove" data-blind-box-unfavorite={favorite.id}
                      aria-label={`取消收藏第 ${index + 1} 个盲盒`} onClick={() => void toggleFavorite(favorite.id, false)}>
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="blind-box-empty">还没有收藏的盲盒。<br /><span>抽到喜欢的组合后，点「收藏这个盲盒」就会出现在这里。</span></p>
            )
          ) : (
            ranking.length ? (
              <ol className="blind-box-ranking">
                {ranking.map((entry) => (
                  <li key={entry.key} data-rank={entry.rank}>
                    <span className="blind-box-rank">{two(entry.rank)}</span>
                    <img src={entry.coverUrl || FALLBACK_COVER} alt="" loading="lazy" />
                    <span className="blind-box-rank-copy"><b>{entry.title}</b><small>{entry.artist} · {entry.styleLabel}</small></span>
                    <span className="blind-box-rank-figures">
                      <b title="被收藏次数"><Icon name="heart" />{entry.favoriteCount}</b>
                      <small title="被抽取次数">{entry.drawCount}</small>
                    </span>
                    <button type="button" data-blind-box-rank-play={entry.key} aria-label={`播放 ${entry.title}`}
                      onClick={() => void playTrack({
                        key: entry.key, source: entry.source, sourceId: entry.sourceId, title: entry.title,
                        artist: entry.artist, album: '未归档', coverUrl: entry.coverUrl, durationMs: 0, duration: '—',
                        style: entry.style, styleLabel: entry.styleLabel,
                      })}>
                      <Icon name="play" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="blind-box-empty">榜单还没有数据。<br /><span>{styleLabel(style)}盲盒被抽取和收藏后，这里会排出值得听的歌。</span></p>
            )
          )}
        </div>
        <footer>
          <span data-blind-box-pool>{poolTotal === null ? '曲库 —' : `曲库 ${poolTotal} 首`}</span>
          <span>OMC / BLIND BOX</span>
        </footer>
      </aside>
    </section>
  )
})

export default BlindBoxPage
