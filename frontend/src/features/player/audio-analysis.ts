import { approach } from '../../rhine/motion'
import { AUDIO_SPECTRUM_SIZE, quietBands, type MusicBands } from '../../rhine/archive-play-motion'

// 节点属于播放器会话；读取由已有场景 RAF 驱动，模块自身不创建定时器。
export function createAudioAnalysis(audio: HTMLAudioElement, factory = () => new AudioContext()) {
  let context: AudioContext | null = null
  let source: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let unavailable = false, disposed = false, lastRead = -Infinity, lastSample = -Infinity
  const data = new Float32Array(1024)
  const spectrum = new Float32Array(AUDIO_SPECTRUM_SIZE)
  const spectrumTarget = new Float32Array(AUDIO_SPECTRUM_SIZE)
  const ranges: [number, number][] = []
  const bands: MusicBands = { ...quietBands(), spectrum }, target = quietBands()
  const reset = () => {
    Object.assign(bands, quietBands()); Object.assign(target, quietBands())
    spectrum.fill(0); spectrumTarget.fill(0)
    lastRead = lastSample = -Infinity
  }
  return {
    async prepare() {
      if (disposed || unavailable) return
      if (!context) {
        let next: AudioContext | null = null
        try {
          next = factory()
          const meter = next.createAnalyser()
          meter.fftSize = 2048
          meter.smoothingTimeConstant = 0.15
          const binHz = next.sampleRate / meter.fftSize
          for (let i = 0; i < AUDIO_SPECTRUM_SIZE; i++) {
            const start = Math.max(1, Math.floor(40 * (10000 / 40) ** (i / AUDIO_SPECTRUM_SIZE) / binHz))
            const end = Math.min(data.length, Math.max(start + 1, Math.ceil(40 * (10000 / 40) ** ((i + 1) / AUDIO_SPECTRUM_SIZE) / binHz)))
            ranges.push([start, end])
          }
          const input = next.createMediaElementSource(audio)
          // 唯一出声路径；分析分支不再连接扬声器。
          input.connect(next.destination)
          context = next; source = input
          try { input.connect(meter); analyser = meter } catch { meter.disconnect() }
        } catch {
          unavailable = true
          if (next) void next.close().catch(() => undefined)
          return
        }
      }
      // 用户播放入口在获取 URL 前调用；已接入图后恢复失败不能伪装成正常出声。
      if (context.state !== 'running') await context.resume()
    },
    read(now: number): MusicBands {
      const dt = Number.isFinite(lastRead) ? Math.min(.1, Math.max(0, now - lastRead)) : 0
      lastRead = now
      const audible = !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3 && audio.volume > 0 && !audio.muted
      if (!disposed && analyser && context?.state === 'running' && audible) {
        if (now - lastSample >= 1 / 30) {
          lastSample = now
          analyser.getFloatFrequencyData(data)
          const energy = (low: number, high: number) => {
            const binHz = context!.sampleRate / analyser!.fftSize
            const start = Math.max(1, Math.ceil(low / binHz))
            const end = Math.min(data.length, Math.ceil(high / binHz))
            let sum = 0
            for (let i = start; i < end; i++) sum += Number.isFinite(data[i]) ? 10 ** (data[i] / 10) : 0
            // 固定增益与噪声门，不对安静段做自动增益。
            return Math.min(1, Math.max(0, Math.sqrt(sum / Math.max(1, end - start)) * 8 - .015))
          }
          for (let i = 0; i < AUDIO_SPECTRUM_SIZE; i++) {
            const [start, end] = ranges[i]
            let peakDb = -Infinity
            for (let bin = start; bin < end; bin++) if (Number.isFinite(data[bin])) peakDb = Math.max(peakDb, data[bin])
            // 固定 -72dB 门限与软压缩；保留窄带乐器，不被宽频均值稀释，不做自动增益。
            spectrumTarget[i] = Math.min(1, Math.max(0, (peakDb + 72) / 48)) ** 1.4
          }
          target.low = energy(30, 180); target.mid = energy(180, 2000); target.high = energy(2000, 10000)
        }
      } else { Object.assign(target, quietBands()); spectrumTarget.fill(0) }
      for (const key of ['low', 'mid', 'high'] as const) {
        bands[key] = approach(bands[key], target[key], target[key] > bands[key] ? 16 : 3.2, dt)
        if (bands[key] < .0001) bands[key] = 0
      }
      let peak = 0
      for (let i = 0; i < spectrum.length; i++) {
        spectrum[i] = approach(spectrum[i], spectrumTarget[i], spectrumTarget[i] > spectrum[i] ? 22 : 4.5, dt)
        if (spectrum[i] < .0001) spectrum[i] = 0
        peak = Math.max(peak, spectrum[i])
      }
      bands.activity = Math.min(1, peak * 3)
      return bands
    },
    reset,
    destroy() {
      disposed = true; reset(); source?.disconnect(); analyser?.disconnect()
      if (context) void context.close().catch(() => undefined)
      source = null; analyser = null; context = null
    },
  }
}
