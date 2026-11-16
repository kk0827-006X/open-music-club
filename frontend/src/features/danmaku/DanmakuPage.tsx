import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { usePageVisibility, useReducedMotion } from '../../shared/react/hooks.ts'
import type { PlayerController } from '../player/player-core.ts'
import {
  createDanmakuClient, dueMessages, formatPosition, loadSettings, matchesBlocklist,
  parseBlocklist, saveSettings,
  type DanmakuClient, type DanmakuMessage, type DanmakuRecentMessage, type DanmakuSettings,
} from '../../services/music/danmaku.ts'

const FLIGHT_MS = 9000
const LANES = 7
const POLL_MS = 15000
const FEED_POLL_MS = 12000
const FEED_MAX = 40
const MAX_FLIGHTS = 40
const FALLBACK_COVER_NOTE = '在播放器里选一首歌，弹幕就会跟着进度飘出来。'

type Flight = { key: string; content: string; nickname: string; lane: number; expireAt: number }

export interface DanmakuPageProps {
  active?: boolean
  client?: DanmakuClient
  // 播放器控制器由 Workspace 注入；弹幕按真实播放进度触发，与播放页共享同一状态。
  player?: PlayerController
}

export interface DanmakuPageHandle {
  refresh(): void
}

const EMPTY_PLAYER = { track: null, currentTime: 0, duration: Number.NaN }

// 从播放条目 key（local:7 / netease:song:11）还原接口需要的歌曲标识。
export function trackRefOf(track: { key: string; title: string; artist: string; duration: string } | null) {
  if (!track) return null
  const index = track.key.indexOf(':')
  if (index <= 0) return null
  const rawSource = track.key.slice(0, index)
  const source: 'local' | 'netease' | null = rawSource === 'local' ? 'local' : rawSource === 'netease' ? 'netease' : null
  if (!source) return null
  const sourceId = track.key.slice(index + 1)
  if (!sourceId) return null
  const parts = track.duration.split(':').map((part) => Number.parseInt(part, 10))
  const durationMs = parts.every((part) => Number.isFinite(part)) && parts.length >= 2
    ? (parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    : 0
  return { source, sourceId, title: track.title, artist: track.artist, durationMs }
}

export const DanmakuPage = forwardRef<DanmakuPageHandle, DanmakuPageProps>(function DanmakuPage(
  { active = true, client: injectedClient, player },
  ref,
) {
  const visible = usePageVisibility(active, 280)
  const reduced = useReducedMotion()
  const client = useMemo(() => injectedClient ?? createDanmakuClient(), [injectedClient])

  const subscribe = useCallback(
    (onStoreChange: () => void) => player?.subscribe(() => onStoreChange()) ?? ((): void => undefined),
    [player],
  )
  const getPlayer = useCallback(() => player?.get() ?? EMPTY_PLAYER, [player])
  const playerState = useSyncExternalStore(subscribe, getPlayer, getPlayer)
  const track = useMemo(() => trackRefOf(playerState.track), [playerState.track])
  // timeupdate 高频触发；进度只在整百毫秒粒度上变化，避免同一位置重复渲染。
  const positionMs = Math.round(playerState.currentTime * 1000)

  const [settings, setSettings] = useState<DanmakuSettings>(() => loadSettings())
  const [messages, setMessages] = useState<DanmakuMessage[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // 全站实时弹幕流：不播放歌曲时弹幕墙也有内容可看。
  const [feed, setFeed] = useState<DanmakuRecentMessage[]>([])
  const [feedTotal, setFeedTotal] = useState(0)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const trackRef = useRef(track)
  trackRef.current = track
  const disposedRef = useRef(false)
  const loadSerialRef = useRef(0)
  const lastIdRef = useRef(0)
  const spawnedUntilRef = useRef(0)
  const flightCounterRef = useRef(0)
  const feedSerialRef = useRef(0)
  const feedLastIdRef = useRef(0)

  const updateSettings = useCallback((patch: Partial<DanmakuSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // 把一条弹幕送上舞台：按轨道计数分配泳道，超量时丢弃最老的飞行体。
  const launchFlight = useCallback((message: { content: string; nickname: string }) => {
    if (settingsRef.current.enabled === false) return
    const words = parseBlocklist(settingsRef.current.blocklist)
    if (matchesBlocklist(message.content, words)) return
    const lane = flightCounterRef.current % LANES
    flightCounterRef.current += 1
    const flight: Flight = {
      key: `flight-${Date.now()}-${flightCounterRef.current}`,
      content: message.content,
      nickname: message.nickname,
      lane,
      expireAt: Date.now() + (reduced ? FLIGHT_MS / 3 : FLIGHT_MS),
    }
    setFlights((previous) => [...previous.slice(-(MAX_FLIGHTS - 1)), flight])
  }, [reduced])

  // 歌曲切换：清空时间轴与飞行体，重新拉取这首弹幕。
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      loadSerialRef.current += 1
    }
  }, [])

  useEffect(() => {
    const serial = ++loadSerialRef.current
    lastIdRef.current = 0
    spawnedUntilRef.current = 0
    setMessages([])
    setFlights([])
    setTotal(0)
    setStatus('')
    if (!track) return
    client.list(track.source, track.sourceId, 0).then((data) => {
      if (disposedRef.current || serial !== loadSerialRef.current) return
      setMessages(data.messages)
      setTotal(data.total)
      lastIdRef.current = data.messages.reduce((latest, message) => Math.max(latest, message.id), 0)
    }).catch((error) => {
      if (disposedRef.current || serial !== loadSerialRef.current) return
      setStatus(error instanceof Error ? error.message : '弹幕读取失败，请稍后刷新')
    })
    // track 由播放器状态派生；同一首歌对象引用变化不重复拉取，key 变化才算切歌。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.source, track?.sourceId])

  // 播放进度推进：到点的弹幕准时起飞；拖动进度条（一次跳过 5 秒以上）静默跳过。
  useEffect(() => {
    if (!track) return
    const serial = loadSerialRef.current
    const previous = spawnedUntilRef.current
    spawnedUntilRef.current = positionMs
    if (!settingsRef.current.enabled) return
    const due = dueMessages(messages, previous, positionMs)
    for (const message of due) launchFlight(message)
    // messages 与 positionMs 都来自同一次渲染快照；serial 防御切歌瞬间的旧 tick。
    void serial
  }, [positionMs, messages, track, launchFlight])

  // 全站实时弹幕流：挂载即拉一次，之后按 afterId 增量轮询。
  const loadFeed = useCallback(async () => {
    if (typeof client.recent !== 'function') return
    const serial = ++feedSerialRef.current
    try {
      const data = await client.recent(feedLastIdRef.current)
      if (disposedRef.current || serial !== feedSerialRef.current) return
      if (data.messages.length) {
        feedLastIdRef.current = data.messages.reduce((latest, message) => Math.max(latest, message.id), feedLastIdRef.current)
        setFeed((previous) => [...data.messages, ...previous].slice(0, FEED_MAX))
      }
      setFeedTotal((previous) => Math.max(previous, data.total))
    } catch {
      /* 实时流失败不打扰页面，下一轮继续 */
    }
  }, [client])

  useEffect(() => {
    void loadFeed()
    return () => { feedSerialRef.current += 1 }
  }, [loadFeed])

  // 定期增量拉新弹幕（轮询足够秒级同步；WebSocket 升级留待后端统一改造）。
  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => {
      if (document.hidden || settingsRef.current.enabled === false) return
      const current = trackRef.current
      if (current) {
        const serial = ++loadSerialRef.current
        client.list(current.source, current.sourceId, lastIdRef.current).then((data) => {
          if (disposedRef.current || serial !== loadSerialRef.current) return
          if (data.messages.length) {
            lastIdRef.current = data.messages.reduce((latest, message) => Math.max(latest, message.id), lastIdRef.current)
            setMessages((previous) => {
              const merged = [...previous, ...data.messages]
              merged.sort((a, b) => a.positionMs - b.positionMs || a.id - b.id)
              return merged
            })
          }
          setTotal((previous) => Math.max(previous, data.total))
        }).catch(() => undefined) // 轮询失败不打扰用户，下一轮继续
      }
      void loadFeed()
    }, FEED_POLL_MS)
    return () => window.clearInterval(timer)
  }, [client, visible, loadFeed])

  // 清理已飘出屏幕的飞行体。
  useEffect(() => {
    if (!flights.length) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setFlights((previous) => previous.filter((flight) => flight.expireAt > now))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [flights.length])

  const send = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = draft.trim()
    const current = trackRef.current
    if (!current) {
      setStatus('先在播放器里播放一首歌，再发送弹幕。')
      return
    }
    if (!content || busy) return
    setBusy(true)
    setStatus('')
    try {
      // 弹幕钉在「此刻」的进度上：别人听到同一秒时，这条弹幕准时飘出。
      const sent = await client.send(current, content, Math.min(positionMs, current.durationMs || positionMs))
      if (disposedRef.current) return
      setMessages((previous) => {
        const merged = [...previous, sent]
        merged.sort((a, b) => a.positionMs - b.positionMs || a.id - b.id)
        return merged
      })
      setTotal((previous) => previous + 1)
      setDraft('')
      launchFlight(sent)
      // 自己的弹幕同时进入全站实时流，让发送立刻可见。
      if (typeof client.recent === 'function') {
        setFeed((previous) => [{ ...sent, trackTitle: current.title, trackArtist: current.artist ?? '' }, ...previous].slice(0, FEED_MAX))
        setFeedTotal((previous) => Math.max(previous, previous + 1))
      }
    } catch (error) {
      if (!disposedRef.current) setStatus(error instanceof Error ? error.message : '弹幕发送失败，请稍后重试')
    } finally {
      if (!disposedRef.current) setBusy(false)
    }
  }, [busy, client, draft, launchFlight, positionMs])

  useImperativeHandle(ref, () => ({ refresh: () => { void loadFeed() } }), [loadFeed])
  const words = useMemo(() => parseBlocklist(settings.blocklist), [settings.blocklist])
  const visibleMessages = useMemo(
    () => messages.filter((message) => !matchesBlocklist(message.content, words)),
    [messages, words],
  )
  const visibleFeed = useMemo(
    () => feed.filter((message) => !matchesBlocklist(message.content, words)),
    [feed, words],
  )
  const blockHint = messages.length !== visibleMessages.length
    ? `已按屏蔽词隐藏 ${messages.length - visibleMessages.length} 条`
    : ''

  return (
    <section className="danmaku-page" data-danmaku-page hidden={!visible}>
      <header className="danmaku-hero">
        <p>DANMAKU WALL / LIVE 002</p>
        <h2>DANMAKU WALL <span>/</span> 热梗弹幕墙</h2>
        <small>弹幕钉在发送那一刻的进度上：别人听到同一秒，它准时飘出来。热梗、剧透、安利，都欢迎上墙。</small>
      </header>
      <div className="danmaku-body">
        <div className="danmaku-main">
          <div className="danmaku-now">
            <span data-danmaku-track-label className="danmaku-track-label">
              {track ? `正在跟随：${track.title} · ${track.artist || '未知艺术家'}` : FALLBACK_COVER_NOTE}
            </span>
            <dl className="danmaku-metrics">
              <div><dt>这首歌的弹幕</dt><dd data-danmaku-total>{total}</dd></div>
              <div><dt>当前进度</dt><dd data-danmaku-clock>{track ? formatPosition(positionMs) : '--:--'}</dd></div>
              <div><dt>全站弹幕</dt><dd data-danmaku-feed-total>{feedTotal}</dd></div>
            </dl>
          </div>

          <div
            className="danmaku-stage"
            data-danmaku-stage
            style={{ opacity: settings.enabled ? settings.opacity : 0 }}
            aria-hidden="true"
          >
            {flights.map((flight) => (
              <span
                key={flight.key}
                className={`danmaku-flight${reduced ? ' is-reduced' : ''}`}
                data-danmaku-flight
                style={{ top: `${flight.lane * (100 / LANES)}%` }}
              >
                {flight.nickname}：{flight.content}
              </span>
            ))}
            {!flights.length && settings.enabled
              ? <p className="danmaku-stage-empty">{track ? '弹幕在歌曲进行到对应进度时飘出，现在还没有到点。' : '播放歌曲后这里就是弹幕的天空。'}</p>
              : null}
          </div>

          <form className="danmaku-composer" data-danmaku-form onSubmit={send}>
            <label htmlFor="danmaku-draft">发一条弹幕（会记录当前进度 {track ? formatPosition(positionMs) : '--:--'}）</label>
            <div className="danmaku-composer-row">
              <input
                id="danmaku-draft"
                data-danmaku-input
                name="content"
                value={draft}
                maxLength={60}
                autoComplete="off"
                placeholder={track ? '高能预警！这段吉他绝了…' : '播放歌曲后可以发弹幕'}
                disabled={!track || busy}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" data-danmaku-send disabled={!track || busy || !draft.trim()}>
                {busy ? '发送中…' : '发射'}
              </button>
            </div>
            <p className="danmaku-status" data-danmaku-status role="status">{status}</p>
          </form>

          <section className="danmaku-controls" aria-label="弹幕设置">
            <button
              type="button"
              data-danmaku-toggle
              aria-pressed={settings.enabled}
              onClick={() => updateSettings({ enabled: !settings.enabled })}
            >
              {settings.enabled ? '弹幕开启中' : '弹幕已关闭'}
            </button>
            <label className="danmaku-opacity">
              透明度
              <input
                type="range"
                data-danmaku-opacity
                min={0.2}
                max={1}
                step={0.05}
                value={settings.opacity}
                disabled={!settings.enabled}
                onChange={(event) => updateSettings({ opacity: Number(event.target.value) })}
              />
              <span data-danmaku-opacity-value>{Math.round(settings.opacity * 100)}%</span>
            </label>
            <label className="danmaku-blocklist">
              屏蔽关键词
              <input
                type="text"
                data-danmaku-blocklist
                value={settings.blocklist}
                placeholder="多个关键词用逗号分隔，例如：剧透,广告"
                onChange={(event) => updateSettings({ blocklist: event.target.value })}
              />
            </label>
            {blockHint ? <p data-danmaku-block-hint>{blockHint}</p> : null}
          </section>

          <section className="danmaku-timeline" aria-label="弹幕时间轴">
            <p>01 / TIMELINE · 这首歌的弹幕</p>
            {visibleMessages.length
              ? <ol data-danmaku-list>
                {visibleMessages.map((message) => (
                  <li key={message.id} data-danmaku-item>
                    <time>{formatPosition(message.positionMs)}</time>
                    <strong>{message.nickname}</strong>
                    <span>{message.content}</span>
                  </li>
                ))}
              </ol>
              : <p className="danmaku-timeline-empty" data-danmaku-empty>
                {track ? '这首歌还没有弹幕，抢占第一条热梗！' : '播放歌曲后，这里的弹幕会按进度排列。'}
              </p>}
          </section>
        </div>

        <aside className="danmaku-feed" aria-label="全站实时弹幕">
          <header className="danmaku-feed-head">
            <p>02 / LIVE FEED</p>
            <h3>全站实时弹幕</h3>
            <span>最新 {FEED_MAX} 条 · 每 {Math.round(FEED_POLL_MS / 1000)} 秒自动刷新</span>
          </header>
          {visibleFeed.length
            ? <ol className="danmaku-feed-list" data-danmaku-feed-list>
              {visibleFeed.map((message) => (
                <li key={message.id} data-danmaku-feed-item>
                  <span className="danmaku-feed-copy"><b>{message.nickname}</b>{message.content}</span>
                  <small>{message.trackTitle}{message.trackArtist ? ` · ${message.trackArtist}` : ''} · {formatPosition(message.positionMs)}</small>
                </li>
              ))}
            </ol>
            : <p className="danmaku-feed-empty" data-danmaku-feed-empty>
              全站还没有弹幕。<br /><span>播一首歌，发出第一条热梗吧。</span>
            </p>}
          <footer className="danmaku-feed-foot">
            <span>OMC / DANMAKU WALL</span>
            <span>弹幕按发送进度回放</span>
          </footer>
        </aside>
      </div>
    </section>
  )
})

export default DanmakuPage
