export interface LyricLine {
  time: number
  text: string
}

type LyricFetcher = (url: string, options: { credentials: 'same-origin'; signal?: AbortSignal }) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>

export function parseLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)]
    const text = row.replace(/\[(\d{1,3}):(\d{2})(?:\.\d{1,3})?\]/g, '').trim()
    if (!text) continue
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text })
    }
  }
  return lines.sort((left, right) => left.time - right.time)
}

// 时间戳有序，二分查找可快速定位当前唱到的歌词行。
export function currentLyricIndex(lines: readonly LyricLine[], seconds: number): number {
  let left = 0
  let right = lines.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (lines[middle].time <= seconds) left = middle + 1
    else right = middle
  }
  return left - 1
}

export async function loadTrackLyrics(
  track: { source: 'local' | 'netease'; sourceId: string },
  fetcher: LyricFetcher = window.fetch.bind(window),
  signal?: AbortSignal,
): Promise<LyricLine[]> {
  if (track.source !== 'netease' || !/^[1-9]\d*$/.test(track.sourceId)) return []
  try {
    const response = await fetcher(`/api/netease/lyric?id=${track.sourceId}`, { credentials: 'same-origin', signal })
    if (!response.ok) return []
    const body = await response.json() as { lrc?: { lyric?: unknown } }
    return typeof body?.lrc?.lyric === 'string' ? parseLyrics(body.lrc.lyric) : []
  } catch (error) {
    if (signal?.aborted) return []
    return []
  }
}
