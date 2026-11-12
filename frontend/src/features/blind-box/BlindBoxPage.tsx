import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../shared/react/ui.tsx'
import { usePageVisibility, useReducedMotion } from '../../shared/react/hooks.ts'
import type { SearchItem } from '../../shared/music.ts'
import {
  createBlindBoxClient,
  toBlindBoxSong,
  type BlindBox,
  type BlindBoxClient,
  type BlindBoxSummary,
  type BlindBoxTrack,
  type RankingEntry,
  type RankingMetric,
} from '../../services/music/blind-box.ts'

const COUNT_OPTIONS = [1, 3, 5] as const
const FALLBACK_COVER = '/images/album-placeholder-01.svg'
// 封面轨道只用渐变唱片，不依赖外链图片；抽中后才显示真实封面。
const ORBIT_TILES = 18
const ORBIT_GRADIENTS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8']
const IDLE_SPEED = 0.24
const SPIN_SPEED = 7.5
// 轨道覆盖整个曲库风格，抽取时不再按分类过滤（分类条上的数量长期为 0，已移除）。
const DRAW_STYLE = 'all'

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

const ORBIT = Array.from({ length: ORBIT_TILES }, (_, index) => ({
  key: `tile-${index}`,
  gradient: ORBIT_GRADIENTS[index % ORBIT_GRADIENTS.length],
  ribbon: index % 2,
  tilt: ((index * 37) % 15) - 7,
  angle: (index / ORBIT_TILES) * Math.PI * 2 + (index % 2) * 0.22,
}))

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
  const [count, setCount] = useState(3)
  const [box, setBox] = useState<BlindBox | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [focusTrack, setFocusTrack] = useState<BlindBoxTrack | null>(null)
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

  // 榜单请求序号：只有仍对应当前筛选的最新响应才能写入，迟到的旧结果直接丢弃。
  const rankingSerialRef = useRef(0)
  // tab 用 ref 读取，避免过期闭包里旧 tab 判断出错。
  const tabRef = useRef(tab)

  useEffect(() => { tabRef.current = tab }, [tab])

  const loadRanking = useCallback(async (nextMetric: RankingMetric) => {
    const serial = ++rankingSerialRef.current
    try {
      const data = await client.ranking(nextMetric, DRAW_STYLE)
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

  // ===== 封面轨道：一帧一帧算位置，别走 React state，避免每帧重渲染 =====
  const orbitRef = useRef<HTMLDivElement | null>(null)
  const coverRefs = useRef<Array<HTMLSpanElement | null>>([])
  const anglesRef = useRef<number[]>(ORBIT.map((tile) => tile.angle))
  const speedRef = useRef(IDLE_SPEED)
  const targetSpeedRef = useRef(IDLE_SPEED)

  useEffect(() => {
    const host = orbitRef.current
    if (!host) return
    const paint = (dt: number) => {
      const width = host.clientWidth || 640
      const height = host.clientHeight || 320
      const cx = width / 2
      const cy = height / 2
      ORBIT.forEach((tile, index) => {
        const el = coverRefs.current[index]
        if (!el) return
        const ribbon = tile.ribbon === 0
          ? { rx: 0.44, squash: 0.34, dir: 1 }
          : { rx: 0.27, squash: 0.28, dir: -1 }
        anglesRef.current[index] += dt * speedRef.current * ribbon.dir
        const angle = anglesRef.current[index]
        const depth = (Math.sin(angle) + 1) / 2
        const x = Math.cos(angle) * ribbon.rx * width
        const y = Math.sin(angle) * ribbon.rx * width * ribbon.squash
        const scale = 0.6 + 0.45 * depth
        const blur = (1 - depth) * 4
        el.style.transform = `translate(${(cx + x - 37).toFixed(1)}px, ${(cy + y - 37).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${tile.tilt}deg)`
        el.style.filter = blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : 'none'
        el.style.opacity = (0.5 + 0.5 * depth).toFixed(2)
        el.style.zIndex = String(10 + Math.round(depth * 40))
      })
    }

    if (reduced) {
      paint(0)
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      speedRef.current += (targetSpeedRef.current - speedRef.current) * Math.min(1, dt * 2.4)
      paint(dt)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [reduced])

  useEffect(() => {
    // 离开页面时把轨道停回待机速度，回来不会一直在飞。
    if (!active) targetSpeedRef.current = IDLE_SPEED
  }, [active])

  const draw = useCallback(async () => {
    if (busy) return
    const current = ++serialRef.current
    setBusy(true)
    setStatus('正在抽取…')
    setHint('')
    setUploadHint(false)
    setRevealed(0)
    setFocusTrack(null)
    targetSpeedRef.current = SPIN_SPEED
    const startedAt = Date.now()
    try {
      const next = await client.draw(DRAW_STYLE, count)
      if (disposedRef.current || current !== serialRef.current) return
      // 动效至少留出可感知的时长，但没有结果时不做无意义等待。
      const remaining = reduced ? 0 : Math.max(0, 1100 - (Date.now() - startedAt))
      if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
      if (disposedRef.current || current !== serialRef.current) return
      // 减速：轨道从飞转回到待机，再把每首依次拉到正中央聚焦。
      targetSpeedRef.current = IDLE_SPEED
      setBox(next)
      if (reduced) {
        setRevealed(next.tracks.length)
      } else {
        for (let index = 0; index < next.tracks.length; index += 1) {
          if (disposedRef.current || current !== serialRef.current) return
          setFocusTrack(next.tracks[index])
          await new Promise((resolve) => window.setTimeout(resolve, 820))
          if (disposedRef.current || current !== serialRef.current) return
          setRevealed(index + 1)
          await new Promise((resolve) => window.setTimeout(resolve, 240))
        }
        if (disposedRef.current || current !== serialRef.current) return
        setFocusTrack(null)
      }
      setBusy(false)
      const styles = [...new Set(next.tracks.map((track) => track.styleLabel))]
      setStatus(`已抽到 ${next.tracks.length} 首 · 风格「${styles.join('/')}」`)
      void loadRanking(metric)
    } catch (error) {
      if (disposedRef.current || current !== serialRef.current) return
      targetSpeedRef.current = IDLE_SPEED
      setBusy(false)
      setBox(null)
      setRevealed(0)
      setFocusTrack(null)
      const message = error instanceof Error ? error.message : '抽取失败，请稍后重试'
      setStatus(message)
      setHint(message)
      setUploadHint(Boolean(onNavigateUpload))
    }
  }, [busy, client, count, reduced, loadRanking, metric, onNavigateUpload])

  const toggleFavorite = useCallback(async (id: number, next: boolean) => {
    try {
      const updated = next ? await client.favorite(id) : await client.unfavorite(id)
      if (disposedRef.current) return
      setBox((previous) => previous?.id === updated.id ? updated : previous)
      setStatus(next ? '已收藏这个盲盒' : '已取消收藏')
      await Promise.all([loadFavorites(), loadRanking(metric)])
    } catch (error) {
      if (disposedRef.current) return
      setStatus(error instanceof Error ? error.message : '收藏失败，请稍后重试')
    }
  }, [client, loadFavorites, loadRanking, metric])

  const openBox = useCallback(async (id: number) => {
    try {
      const opened = await client.box(id)
      if (disposedRef.current) return
      setBox(opened)
      setRevealed(opened.tracks.length)
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
        setPoolTotal(data.total)
      }).catch(() => undefined)
      void loadFavorites()
      void loadRanking(metric)
    },
  }))

  const switchMetric = useCallback((next: RankingMetric) => {
    setMetric(next)
    void loadRanking(next)
  }, [loadRanking])

  const hintText = busy
    ? '封面轨道正在飞转，马上揭晓…'
    : `点一下抽取，封面轨道会把这箱 ${count} 首依次拉到正中央。`

  return (
    <section className="blind-box-page" data-blind-box-page hidden={!visible} inert={!active} aria-label="音乐盲盒">
      <header className="blind-box-heading">
        <p>BLIND BOX / LUCKY SPIN 001</p>
        <h2>BLIND BOX <span>/</span> 音乐盲盒</h2>
        <small>不知道听什么的时候，点一下抽取——封面轨道飞转，停在哪张就抽中哪首。</small>
      </header>

      <section className={`blind-box-stage${busy ? ' is-busy' : ''}${focusTrack ? ' is-focusing' : ''}`}
        data-blind-box-stage aria-label="抽取区">
        <div className="blind-box-stage-head">
          <span>SPIN SHUTTER / 封面轨道</span>
          <b data-blind-box-number>{box ? `BOX #${two(box.id)}` : 'BOX #—'}</b>
        </div>
        <div className="blind-box-orbit" ref={orbitRef} data-blind-box-orbit>
          {ORBIT.map((tile, index) => (
            <span key={tile.key} ref={(el) => { coverRefs.current[index] = el }}
              className={`blind-box-orbit-cover blind-box-tone-${tile.gradient}`} aria-hidden="true" />
          ))}
          {focusTrack && (
            <div key={focusTrack.key} className="blind-box-focus" data-blind-box-focus aria-live="polite">
              <img src={focusTrack.coverUrl || FALLBACK_COVER} alt="" />
              <p>{focusTrack.title}<span>{focusTrack.artist}</span></p>
            </div>
          )}
          <button type="button" className="blind-box-draw" data-blind-box-draw disabled={busy} onClick={() => void draw()}>
            <span>抽取</span><i>SPIN IT</i>
          </button>
        </div>
        <div className="blind-box-stage-foot">
          <div className="blind-box-count" role="group" aria-label="每箱歌曲数量"><span>每箱</span>
            {COUNT_OPTIONS.map((value) => (
              <button key={value} type="button" data-blind-box-count={value} disabled={busy}
                aria-pressed={value === count} onClick={() => setCount(value)}>{value}</button>
            ))}
            <span>首</span>
          </div>
          <p className="blind-box-hint" data-blind-box-hint aria-live="polite">
            {hint
              ? <>{hint}{uploadHint && onNavigateUpload && (
                <button type="button" className="blind-box-inline-link" data-blind-box-upload onClick={onNavigateUpload}>去上传音乐</button>
              )}</>
              : hintText}
          </p>
        </div>
      </section>

      <section className="blind-box-results" data-blind-box-result hidden={!box} aria-label="本次抽到">
        <div className="blind-box-result-head">
          <p>RESULT / 本次抽到</p>
          <strong>{box ? `本次抽到 ${box.tracks.length} 首` : '等待抽取'}</strong>
          <span>{box ? `${box.styleLabel} · ${formatStamp(box.createdAt)}` : ''}</span>
        </div>
        <div className="blind-box-cards">
          {box?.tracks.slice(0, revealed).map((track, index) => (
            <article key={track.key} className="blind-box-card is-revealed" data-blind-box-card={track.key}
              style={{ '--card-delay': `${index * 60}ms` } as CSSProperties}>
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
      </section>

      <div className="blind-box-actions" data-blind-box-actions hidden={!box}>
        <button type="button" data-blind-box-again disabled={busy} onClick={() => void draw()}><Icon name="dice" /><span>再抽一箱</span></button>
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
            onClick={() => { setTab('ranking'); void loadRanking(metric) }}>盲盒榜单</button>
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
              <p className="blind-box-empty">榜单还没有数据。<br /><span>盲盒被抽取和收藏后，这里会排出值得听的歌。</span></p>
            )
          )}
        </div>
        <footer>
          <span data-blind-box-pool>{poolTotal === null ? '曲库 —' : `曲库 ${poolTotal} 首`}</span>
          <span>{favoritesTotal > 0 ? `收藏 ${favoritesTotal} 箱` : 'OMC / BLIND BOX'}</span>
        </footer>
      </aside>
    </section>
  )
})

export default BlindBoxPage
