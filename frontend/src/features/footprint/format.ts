import { safeCoverUrl, type SearchItem } from '../../shared/music.ts'
import type { FootprintEvent } from '../../services/music/footprint.ts'

export const siteOffset = (value?: number) => Number.isInteger(value) && Math.abs(value!) <= 1440 ? value! : 480
// SQLite 的无时区时间是 UTC，先补齐 ISO 时区，避免浏览器按本机时区解释。
const shifted = (value: string, offset = 480) => {
  const normalized = value.trim().replace(' ', 'T')
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized) ? `${normalized}Z` : normalized
  return new Date(new Date(utc).getTime() + siteOffset(offset) * 60000)
}
export function dayKey(value: string, offset = 480) {
  const date = shifted(value, offset)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '未知日期'
}
export function formatDate(value: string, offset = 480) {
  const date = shifted(value, offset)
  return Number.isFinite(date.getTime()) ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日` : '未知日期'
}
export function formatClock(value: string, offset = 480) {
  const date = shifted(value, offset)
  return Number.isFinite(date.getTime()) ? `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}` : '—'
}
export const formatDuration = (value: number) => value >= 3600000 ? `${(value / 3600000).toFixed(1)} 小时` : `${Math.floor(Math.max(0, value) / 60000)} 分钟`
export const formatTrackDuration = (value: number) => `${Math.floor(Math.max(0, value) / 60000)}:${String(Math.floor(Math.max(0, value) / 1000) % 60).padStart(2, '0')}`
export function toFootprintSong(track: Pick<FootprintEvent, 'source' | 'sourceId' | 'trackKey' | 'title' | 'artist' | 'coverUrl' | 'durationMs'> & { album?: string | null }): SearchItem {
  return { key: track.trackKey, kind: 'song', source: track.source, sourceId: track.sourceId,
    title: track.title, artist: track.artist, album: track.album || '未归档', coverUrl: safeCoverUrl(track.coverUrl),
    duration: formatTrackDuration(track.durationMs), year: '—', description: '' }
}
