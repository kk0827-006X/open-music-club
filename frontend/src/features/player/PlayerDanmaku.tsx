import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MusicItem } from '../../shared/music.ts'
import { useReducedMotion } from '../../shared/react/hooks.ts'
import {
  createDanmakuClient, dueMessages, formatPosition, loadSettings, saveSettings, trackRefOf,
  type DanmakuClient, type DanmakuKind, type DanmakuMessage, type DanmakuSettings,
} from '../../services/music/danmaku.ts'

const FLIGHT_MS = 9000
const LANES = 6
const POLL_MS = 12000
const MAX_FLIGHTS = 36
const VOICE_MAX_MS = 60000

type ComposerTab = 'compose' | 'voice'

type Flight = {
  key: string
  kind: DanmakuKind
  content: string
  nickname: string
  lane: number
  mine: boolean
  mediaUrl: string | null
  mediaDurationMs: number
  expireAt: number
}

type VoiceReady = { blob: Blob; durationMs: number; url: string }
type ImageReady = { file: File; url: string }

export interface PlayerDanmakuProps {
  // 正在播放的歌曲；没有歌曲时只显示引导语，不能发送。
  track: MusicItem | null
  positionMs: number
  paused: boolean
  client?: DanmakuClient
}

function voiceExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function secondsLabel(durationMs: number): string {
  return `${Math.max(1, Math.round(durationMs / 1000))}″`
}

// 播放器右列的内嵌弹幕墙：和展开歌词共用同一块区域，由外层切换「歌词 / 弹幕」。
// 弹幕按播放进度触发；发送板块只有两个：文字 / 图片（可只发文字，也可选图后配一句话）和语音。
export function PlayerDanmaku({ track, positionMs, paused, client: injectedClient }: PlayerDanmakuProps) {
  const reduced = useReducedMotion()
  const client = useMemo(() => injectedClient ?? createDanmakuClient(), [injectedClient])
  const trackRef = useMemo(() => (track
    ? trackRefOf({ key: track.key, title: track.title, artist: track.artist, duration: track.duration })
    : null), [track])

  const [settings, setSettings] = useState<DanmakuSettings>(() => loadSettings())
  const [messages, setMessages] = useState<DanmakuMessage[]>([])
  const [flights, setFlights] = useState<Flight[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<ComposerTab>('compose')
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [voiceReady, setVoiceReady] = useState<VoiceReady | null>(null)
  const [imageReady, setImageReady] = useState<ImageReady | null>(null)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const positionRef = useRef(positionMs)
  positionRef.current = positionMs
  const disposedRef = useRef(false)
  const loadSerialRef = useRef(0)
  const lastIdRef = useRef(0)
  const spawnedUntilRef = useRef(0)
  const laneCounterRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderStreamRef = useRef<MediaStream | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])
  const recorderStartRef = useRef(0)
  const recorderTimerRef = useRef(0)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  const updateSettings = useCallback((patch: Partial<DanmakuSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // 把一条弹幕送上弹幕墙：按顺序分配泳道，超量时丢弃最老的飞行体。
  const launch = useCallback((message: {
    content: string
    nickname?: string
    kind?: DanmakuKind
    mediaUrl?: string | null
    mediaDurationMs?: number
    mine?: boolean
  }) => {
    if (!settingsRef.current.enabled) return
    const lane = laneCounterRef.current % LANES
    laneCounterRef.current += 1
    const flight: Flight = {
      key: `player-dm-${Date.now()}-${laneCounterRef.current}`,
      kind: message.kind ?? 'text',
      content: message.content,
      nickname: message.nickname ?? '',
      lane,
      mine: Boolean(message.mine),
      mediaUrl: message.mediaUrl ?? null,
      mediaDurationMs: message.mediaDurationMs ?? 0,
      expireAt: Date.now() + FLIGHT_MS + 1500,
    }
    setFlights((previous) => [...previous.slice(-(MAX_FLIGHTS - 1)), flight])
  }, [])

  // 组件卸载时别把录音和临时 URL 漏在页面里。
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      loadSerialRef.current += 1
      window.clearInterval(recorderTimerRef.current)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      recorderStreamRef.current?.getTracks().forEach((trackItem) => trackItem.stop())
      recorderStreamRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (voiceReady) URL.revokeObjectURL(voiceReady.url)
  }, [voiceReady])

  useEffect(() => () => {
    if (imageReady) URL.revokeObjectURL(imageReady.url)
  }, [imageReady])

  // 切歌：清空时间轴与飞行体，重新拉取这首歌的弹幕。
  useEffect(() => {
    const serial = ++loadSerialRef.current
    lastIdRef.current = 0
    spawnedUntilRef.current = 0
    setMessages([])
    setFlights([])
    setTotal(0)
    setStatus('')
    if (!trackRef) return
    client.list(trackRef.source, trackRef.sourceId, 0).then((data) => {
      if (disposedRef.current || serial !== loadSerialRef.current) return
      setMessages(data.messages)
      setTotal(data.total)
      lastIdRef.current = data.messages.reduce((latest, message) => Math.max(latest, message.id), 0)
    }).catch((error) => {
      if (disposedRef.current || serial !== loadSerialRef.current) return
      setStatus(error instanceof Error ? error.message : '弹幕读取失败，请稍后刷新')
    })
    // 同一首歌对象引用变化不重复拉取，key 变化才算切歌。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackRef?.source, trackRef?.sourceId])

  // 播放进度推进：到点的弹幕准时起飞；拖动进度条（一次跳过 5 秒以上）静默跳过。
  useEffect(() => {
    if (!trackRef) return
    const previous = spawnedUntilRef.current
    spawnedUntilRef.current = positionMs
    if (!settingsRef.current.enabled) return
    for (const message of dueMessages(messages, previous, positionMs)) launch(message)
    // messages 与 positionMs 来自同一次渲染快照；切歌由 trackRef 重置检查点。
  }, [positionMs, messages, trackRef, launch])

  // 轮询增量拉新；面板挂在展开播放器里，只在可见时工作。
  useEffect(() => {
    if (!trackRef) return
    const timer = window.setInterval(() => {
      if (document.hidden || settingsRef.current.enabled === false) return
      const serial = ++loadSerialRef.current
      client.list(trackRef.source, trackRef.sourceId, lastIdRef.current).then((data) => {
        if (disposedRef.current || serial !== loadSerialRef.current) return
        if (data.messages.length) {
          lastIdRef.current = data.messages.reduce((latest, message) => Math.max(latest, message.id), lastIdRef.current)
          setMessages((previous) => {
            const merged = [...previous, ...data.messages]
            merged.sort((item, other) => item.positionMs - other.positionMs || item.id - other.id)
            return merged
          })
        }
        setTotal((previous) => Math.max(previous, data.total))
      }).catch(() => undefined) // 轮询失败不打扰用户，下一轮继续
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [client, trackRef])

  // 清理已经飘出屏幕的飞行体。
  useEffect(() => {
    if (!flights.length) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setFlights((previous) => previous.filter((flight) => flight.expireAt > now))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [flights.length])

  const appendSent = useCallback((sent: DanmakuMessage) => {
    setMessages((previous) => {
      const merged = [...previous, sent]
      merged.sort((a, b) => a.positionMs - b.positionMs || a.id - b.id)
      return merged
    })
    setTotal((previous) => previous + 1)
    launch({ ...sent, mine: true })
  }, [launch])

  // 合并板块：有图走图片弹幕（输入框文字作为配文，可留空），没图就是纯文字弹幕。
  const sendCompose = useCallback(async () => {
    const content = draft.trim()
    if ((!content && !imageReady) || busy || !trackRef) return
    setBusy(true)
    setStatus('')
    try {
      if (imageReady) {
        if (typeof client.uploadMedia !== 'function') throw new Error('当前环境不支持媒体上传')
        const extension = imageReady.file.name.includes('.') ? imageReady.file.name.split('.').pop() || 'png' : 'png'
        const uploaded = await client.uploadMedia(imageReady.file, 'image', `danmaku.${extension}`)
        const sent = await client.send(trackRef, content, positionMs, { kind: 'image', mediaPath: uploaded.path })
        if (disposedRef.current) return
        setImageReady(null)
        appendSent(sent)
      } else {
        // 弹幕钉在「此刻」的进度上：别人听到同一秒时，这条弹幕准时飘出。
        const sent = await client.send(trackRef, content, positionMs)
        if (disposedRef.current) return
        appendSent(sent)
      }
      if (disposedRef.current) return
      setDraft('')
    } catch (error) {
      if (!disposedRef.current) setStatus(error instanceof Error ? error.message : '弹幕发送失败，请稍后重试')
    } finally {
      if (!disposedRef.current) setBusy(false)
    }
  }, [appendSent, busy, client, draft, imageReady, positionMs, trackRef])

  const startRecording = useCallback(async () => {
    if (!trackRef || busy || recording) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('当前浏览器不支持录音，可以改用文字弹幕。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (disposedRef.current) {
        stream.getTracks().forEach((trackItem) => trackItem.stop())
        return
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      recorderStreamRef.current = stream
      recorderChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const durationMs = Math.min(VOICE_MAX_MS, Math.max(500, Date.now() - recorderStartRef.current))
        const blob = new Blob(recorderChunksRef.current, { type: mimeType || 'audio/webm' })
        stream.getTracks().forEach((trackItem) => trackItem.stop())
        recorderStreamRef.current = null
        recorderRef.current = null
        window.clearInterval(recorderTimerRef.current)
        if (!disposedRef.current) {
          setRecording(false)
          setVoiceReady({ blob, durationMs, url: URL.createObjectURL(blob) })
        }
      }
      recorderStartRef.current = Date.now()
      recorder.start()
      setStatus('')
      setVoiceReady(null)
      setRecording(true)
      setRecSeconds(0)
      recorderTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recorderStartRef.current
        setRecSeconds(Math.floor(elapsed / 1000))
        // 到 60 秒自动收尾，避免上传超长语音被服务端拒绝。
        if (elapsed >= VOICE_MAX_MS && recorder.state !== 'inactive') recorder.stop()
      }, 250)
    } catch {
      setStatus('没有拿到麦克风权限，可以在浏览器设置里允许后重试。')
    }
  }, [busy, recording, trackRef])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    if (Date.now() - recorderStartRef.current >= VOICE_MAX_MS) {
      recorder.stop()
      return
    }
    recorder.stop()
  }, [])

  const sendVoice = useCallback(async () => {
    if (!voiceReady || !trackRef || busy) return
    setBusy(true)
    setStatus('')
    try {
      if (typeof client.uploadMedia !== 'function') throw new Error('当前环境不支持媒体上传')
      const uploaded = await client.uploadMedia(
        voiceReady.blob, 'voice', `voice.${voiceExtension(voiceReady.blob.type)}`, voiceReady.durationMs,
      )
      const sent = await client.send(trackRef, '', positionMs, {
        kind: 'voice', mediaPath: uploaded.path, mediaDurationMs: voiceReady.durationMs,
      })
      if (disposedRef.current) return
      setVoiceReady(null)
      appendSent(sent)
    } catch (error) {
      if (!disposedRef.current) setStatus(error instanceof Error ? error.message : '语音弹幕发送失败，请稍后重试')
    } finally {
      if (!disposedRef.current) setBusy(false)
    }
  }, [appendSent, busy, client, positionMs, trackRef, voiceReady])

  const pickImage = useCallback((file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setStatus('请选择图片文件（jpg / png / webp / gif）。')
      return
    }
    setStatus('')
    setImageReady((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return { file, url: URL.createObjectURL(file) }
    })
  }, [])

  const clearImage = useCallback(() => {
    setImageReady((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
  }, [])

  const playVoice = useCallback((url: string | null) => {
    const element = voiceAudioRef.current
    if (!url || !element) return
    // 语音弹幕用独立的隐藏 audio 播放短音频，不参与播放器那一个 Audio 的归属。
    element.src = url
    void element.play().catch(() => undefined)
  }, [])

  const removeFlight = useCallback((key: string) => {
    setFlights((previous) => previous.filter((flight) => flight.key !== key))
  }, [])

  const enabled = settings.enabled
  const canSend = Boolean(trackRef) && !busy

  return (
    <div className="player-dm" data-player-danmaku>
      <audio ref={voiceAudioRef} data-player-dm-audio preload="none" hidden />
      <div className="player-dm-meta">
        <span data-player-dm-total>{trackRef ? `弹幕 ${total} 条` : '还没有跟随的歌曲'}</span>
        <span>{trackRef ? `${paused ? '已暂停' : '正在播放'} · ${formatPosition(positionMs)}` : '播放歌曲后弹幕会按进度飘出'}</span>
      </div>

      <div
        className="player-dm-wall"
        data-player-dm-wall
        aria-label="弹幕墙"
        style={{ opacity: enabled ? settings.opacity : 0.08 }}
      >
        {flights.map((flight) => {
          const style = {
            top: `${((flight.lane + 0.5) * 100) / LANES}%`,
            animationDuration: `${reduced ? 3200 : FLIGHT_MS}ms`,
          }
          const className = `player-dm-flight${flight.mine ? ' is-mine' : ''}${reduced ? ' is-reduced' : ''}`
          if (flight.kind === 'voice') {
            return (
              <button
                key={flight.key}
                type="button"
                className={`${className} is-voice`}
                style={style}
                data-player-dm-flight
                aria-label={`播放 ${secondsLabel(flight.mediaDurationMs)} 的语音弹幕`}
                onClick={() => playVoice(flight.mediaUrl)}
                onAnimationEnd={() => removeFlight(flight.key)}
              >
                <span className="player-dm-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span>{secondsLabel(flight.mediaDurationMs)}</span>
                {flight.mine ? <i className="player-dm-badge">我发的</i> : null}
              </button>
            )
          }
          if (flight.kind === 'image' && flight.mediaUrl) {
            return (
              <figure
                key={flight.key}
                className={`${className} is-image`}
                style={style}
                data-player-dm-flight
                onAnimationEnd={() => removeFlight(flight.key)}
              >
                <img src={flight.mediaUrl} alt={flight.content || '图片弹幕'} />
                <figcaption>{flight.mine ? '我发的 · ' : ''}{flight.content || '现场图'}</figcaption>
              </figure>
            )
          }
          return (
            <span
              key={flight.key}
              className={className}
              style={style}
              data-player-dm-flight
              onAnimationEnd={() => removeFlight(flight.key)}
            >
              {flight.mine ? <i className="player-dm-badge">我发的</i> : null}
              {flight.content}
            </span>
          )
        })}
        {!flights.length
          ? <p className="player-dm-empty">{trackRef ? '弹幕会跟着播放进度准时飘出，也可以先发一条。' : '播放歌曲后这里就是弹幕的天空。'}</p>
          : null}
      </div>

      <div className="player-dm-composer">
        <div className="player-dm-tabs">
          <button type="button" data-player-dm-tab="text" className={tab === 'compose' ? 'is-active' : undefined} onClick={() => setTab('compose')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M12 6v12" /></svg>文字 / 图片
          </button>
          <button type="button" data-player-dm-tab="voice" className={tab === 'voice' ? 'is-active' : undefined} onClick={() => setTab('voice')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>语音
          </button>
          <span className="player-dm-spacer" />
          <span className="player-dm-enable">弹幕显示
            <button
              type="button"
              className={`player-dm-switch${enabled ? ' is-on' : ''}`}
              data-player-dm-toggle
              aria-pressed={enabled}
              aria-label="弹幕显示开关"
              onClick={() => updateSettings({ enabled: !enabled })}
            />
          </span>
        </div>

        {tab === 'compose' ? (
          <>
            <div className={`player-dm-row${imageReady ? ' has-image' : ''}`} data-player-dm-row-compose>
              <input
                type="text"
                data-player-dm-input
                value={draft}
                maxLength={60}
                autoComplete="off"
                placeholder={imageReady
                  ? '给这张图配一句话（可留空）…'
                  : trackRef ? '发一条弹幕，和听这首歌的人聊聊…' : '播放歌曲后可以发弹幕'}
                disabled={!trackRef || busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void sendCompose() }}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(event) => {
                  pickImage(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className={`player-dm-pick${imageReady ? ' is-picked' : ''}`}
                data-player-dm-pick
                disabled={!trackRef || busy}
                aria-label={imageReady ? '取消已选图片' : '附带一张图片'}
                onClick={() => { if (imageReady) clearImage(); else imageInputRef.current?.click() }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-5 4 4 3-3 4 4" /></svg>
                {imageReady ? '取消图' : '选图'}
              </button>
              <button
                type="button"
                className="player-dm-send"
                data-player-dm-send
                disabled={!canSend || (!draft.trim() && !imageReady)}
                onClick={() => void sendCompose()}
              >
                {busy ? '发送中…' : '发射'}
              </button>
            </div>
            {imageReady ? (
              <div className="player-dm-attach" data-player-dm-attach>
                <span className="player-dm-chip is-picked" data-player-dm-image-chip>
                  <img src={imageReady.url} alt="待发送的图片" />
                  <span className="player-dm-chip-copy">
                    <b>图片已就绪</b>
                    <small>发射后随弹幕飘出</small>
                  </span>
                  <button type="button" aria-label="取消这张图片" data-player-dm-image-clear onClick={clearImage}>×</button>
                </span>
                <span className="player-dm-attach-hint">图片会带着输入框里的文字一起飘出去，文字可留空</span>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'voice' ? (
          <div className="player-dm-row">
            {recording ? (
              <button type="button" className="player-dm-recording" data-player-dm-mic onClick={stopRecording}>
                <i className="player-dm-rec-dot" aria-hidden="true" />录音中 {recSeconds}s · 点击结束
              </button>
            ) : (
              <button type="button" className="player-dm-mic" data-player-dm-mic disabled={!canSend} onClick={() => void startRecording()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
                录一段语音（最长 60 秒）
              </button>
            )}
            {voiceReady
              ? <span className="player-dm-chip" data-player-dm-voice-chip>
                语音 {secondsLabel(voiceReady.durationMs)} 已就绪
                <button type="button" aria-label="取消这条语音" onClick={() => setVoiceReady(null)}>×</button>
              </span>
              : null}
            <span className="player-dm-spacer" />
            <button
              type="button"
              className="player-dm-send"
              data-player-dm-voice-send
              disabled={!canSend || !voiceReady}
              onClick={() => void sendVoice()}
            >
              {busy ? '发送中…' : '发送语音'}
            </button>
          </div>
        ) : null}

        <p className="player-dm-status" data-player-dm-status role="status">{status}</p>
      </div>
    </div>
  )
}

export default PlayerDanmaku
