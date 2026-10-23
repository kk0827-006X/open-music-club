import { forwardRef } from 'react'
import type { MemoryCard } from '../../services/music/footprint.ts'
import { formatDate, formatDuration } from './format.ts'

const clip = (value: string, size: number) => value.length > size ? `${value.slice(0, size)}…` : value

// 文本由 React 转义；卡片没有外链、脚本或用户传入的 SVG 属性。
export const CardArtwork = forwardRef<SVGSVGElement, { card: Pick<MemoryCard, 'title' | 'data'>; offset: number }>(function CardArtwork({ card, offset }, ref) {
  const data = card.data
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 660" width="480" height="660" role="img" aria-label={`${card.title}，音乐足迹回忆卡片`} className="fp-card-art">
    <rect width="480" height="660" rx="18" fill="var(--paper)" />
    <rect x="16" y="16" width="448" height="628" rx="12" fill="none" stroke="var(--amber)" strokeOpacity=".5" />
    <g fontFamily="Helvetica, Arial, sans-serif">
      <text x="44" y="62" fill="var(--amber)" fontSize="11" letterSpacing="4">MUSIC FOOTPRINT</text>
      <text x="44" y="104" fill="var(--ink)" fontSize="27" fontWeight="700">{clip(card.title, 16)}</text>
      <text x="44" y="132" fill="var(--muted)" fontSize="13">{formatDate(data.period.from, offset)} — {formatDate(data.period.to, offset)}</text>
      <line x1="44" y1="152" x2="436" y2="152" stroke="var(--amber)" strokeOpacity=".3" />
      <text x="44" y="180" fill="var(--muted)" fontSize="11" letterSpacing="2">SELECTED TRACKS / {data.trackCount} 段声音</text>
      {data.tracks.slice(0, 6).map((track, index) => <g key={index}>
        <text x="44" y={212 + index * 43} fill="var(--muted)" fontSize="13">{String(index + 1).padStart(2, '0')}</text>
        <text x="78" y={212 + index * 43} fill="var(--ink)" fontSize="15">{clip(track.title, 18)}</text>
        <text x="78" y={230 + index * 43} fill="var(--muted)" fontSize="12">{clip(track.artist, 24)}</text>
      </g>)}
      {data.notes.slice(0, 2).map((note, index) => <text key={index} x="44" y={486 + index * 22} fill="var(--muted)" fontSize="12">「{clip(note.content, 30)}」</text>)}
      <line x1="44" y1="552" x2="436" y2="552" stroke="var(--amber)" strokeOpacity=".3" />
      <text x="44" y="583" fill="var(--ink)" fontSize="25" fontWeight="700">{data.trackCount}</text>
      <text x="44" y="604" fill="var(--muted)" fontSize="11">次播放记录</text>
      <text x="178" y="583" fill="var(--ink)" fontSize="25" fontWeight="700">{formatDuration(data.totalDurationMs)}</text>
      <text x="178" y="604" fill="var(--muted)" fontSize="11">陪伴时长</text>
      <text x="340" y="583" fill="var(--ink)" fontSize="17" fontWeight="700">{clip(data.highlight?.title || '—', 6)}</text>
      <text x="340" y="604" fill="var(--muted)" fontSize="11">听得最多</text>
      <text x="436" y="634" textAnchor="end" fill="var(--muted)" fontSize="10" letterSpacing="2">OPEN MUSIC CLUB</text>
    </g>
  </svg>
})

// 只序列化本组件产生的 SVG，并将站点主题令牌固化到可离线打开的文件。
export function downloadCardArtwork(svg: SVGSVGElement, title: string) {
  const theme = getComputedStyle(svg)
  const Serializer = svg.ownerDocument.defaultView?.XMLSerializer
  if (!Serializer) throw new Error('当前环境不支持卡片下载')
  const xml = new Serializer().serializeToString(svg).replace(/var\((--(?:paper|amber|ink|muted))\)/g, (_, token: string) => theme.getPropertyValue(token).trim())
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || '音乐足迹'}.svg`
    link.click()
  } finally { URL.revokeObjectURL(url) }
}
