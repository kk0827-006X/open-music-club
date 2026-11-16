import { serializeCardArtwork } from './card-export.ts';
import { forwardRef, useId } from 'react';
import type { MemoryCard } from '../../services/music/footprint.ts';
import { formatDate } from './format.ts';
import { CardBackdrop } from './CardBackdrop.tsx';
import { cardDuration, cardLayout, cardPalette } from './card-design.ts';

const clip = (value: string, size: number) => {
  const characters = Array.from(value);
  return characters.length > size ? `${characters.slice(0, size).join('')}…` : value;
};

// 保留来源卡片排版，用 React 文本节点转义；渐变按组件实例隔离，预览和列表不会串色。
export const CardArtwork = forwardRef<
  SVGSVGElement,
  { card: Pick<MemoryCard, 'title' | 'data'>; offset: number }
>(function CardArtwork({ card, offset }, ref) {
  const uid = `fp-card-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const data = card.data;
  const {
    tracks,
    notes,
    step,
    noteSize,
    height,
    titleLines,
    titleSize,
    artistSize,
    badgeRadius,
    listTop,
    footer,
  } = cardLayout(card);
  const notesTop = listTop + tracks.length * step;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 480 ${height}`}
      width="480"
      height={height}
      role="img"
      aria-label={`${card.title}，音乐足迹回忆卡片`}
      className="fp-card-art"
      data-card-palette={cardPalette(card, offset)}
      fontFamily="Helvetica, Arial, sans-serif"
    >
      <CardBackdrop uid={uid} height={height} />
      <rect
        x="16"
        y="16"
        width="448"
        height={height - 32}
        rx="15"
        fill="none"
        stroke="var(--fp-card-white)"
        strokeOpacity=".7"
        strokeWidth="1.5"
      />
      <rect
        x="24"
        y="24"
        width="432"
        height={height - 48}
        rx="10"
        fill="none"
        stroke="var(--fp-card-accent)"
        strokeOpacity=".18"
      />
      <g fill="var(--fp-card-accent)" opacity=".26" aria-hidden="true">
        {[7, 13, 21, 9, 16, 24, 11, 18, 8, 14, 22, 9].map((barHeight, index) => (
          <rect
            key={index}
            x={328 + index * 9}
            y={footer - 18 - barHeight}
            width="3.4"
            height={barHeight}
            rx="1.7"
            opacity={0.55 + (index % 3) * 0.2}
          />
        ))}
      </g>
      <circle cx="46" cy="60" r="3.2" fill="var(--fp-card-accent)" opacity=".85" />
      <text
        x="58"
        y="64"
        fill="var(--fp-card-accent)"
        fontSize="9.5"
        letterSpacing="4.2"
        fontWeight="600"
      >
        MUSIC FOOTPRINT
      </text>
      <text x="436" y="64" textAnchor="end" fill="var(--fp-card-muted)" fontSize="10.5">
        {formatDate(data.period.from, offset)} — {formatDate(data.period.to, offset)}
      </text>
      {titleLines.map((line, index) => (
        <text
          key={index}
          x="44"
          y={118 + index * 32}
          fill="var(--fp-card-ink)"
          fontSize="25"
          fontWeight="700"
          letterSpacing=".4"
        >
          {line}
        </text>
      ))}
      <line x1="44" y1="176" x2="436" y2="176" stroke="var(--fp-card-accent)" strokeOpacity=".26" />
      <text
        x="44"
        y="202"
        fill="var(--fp-card-muted)"
        fontSize="9.5"
        letterSpacing="2.4"
        fontWeight="600"
      >
        精选片段 / SELECTED TRACKS
      </text>
      <text x="436" y="202" textAnchor="end" fill="var(--fp-card-accent)" fontSize="10">
        {data.trackCount} 段声音
      </text>
      {tracks.map((track, index) => {
        const y = listTop + index * step;
        return (
          <g key={index}>
            <circle
              cx="56"
              cy={y - 4}
              r={badgeRadius}
              fill="var(--fp-card-chip)"
              stroke="var(--fp-card-accent)"
              strokeOpacity=".22"
            />
            <text
              x="56"
              y={y}
              textAnchor="middle"
              fill="var(--fp-card-accent)"
              fontSize={badgeRadius - 1.5}
              fontWeight="600"
            >
              {String(index + 1).padStart(2, '0')}
            </text>
            <text x="80" y={y} fill="var(--fp-card-ink)" fontSize={titleSize} fontWeight="550">
              {clip(track.title, Math.floor(344 / titleSize))}
            </text>
            <text x="80" y={y + titleSize + 3} fill="var(--fp-card-muted)" fontSize={artistSize}>
              {clip(track.artist, 26)}
            </text>
          </g>
        );
      })}
      {notes.map((note, index) => {
        const y = notesTop + 8 + noteSize + index * (noteSize + 20);
        return (
          <g key={index}>
            <rect
              x="44"
              y={y - noteSize}
              width="3"
              height={noteSize + 8}
              rx="1.5"
              fill="var(--fp-card-accent)"
              opacity=".42"
            />
            <text
              x="58"
              y={y}
              fill="var(--fp-card-muted)"
              fontSize={noteSize}
              fontStyle="italic"
              fontFamily="Georgia, 'Songti SC', serif"
            >
              「{clip(note.content, Math.min(26, Math.floor(378 / noteSize) - 3))}」
            </text>
          </g>
        );
      })}
      <line
        x1="44"
        y1={footer}
        x2="436"
        y2={footer}
        stroke="var(--fp-card-accent)"
        strokeOpacity=".26"
      />
      <text x="44" y={footer + 42} fill="var(--fp-card-ink)" fontSize="27" fontWeight="700">
        {data.trackCount}
      </text>
      <text x="44" y={footer + 62} fill="var(--fp-card-muted)" fontSize="10.5">
        段播放记录
      </text>
      <text x="186" y={footer + 42} fill="var(--fp-card-ink)" fontSize="24" fontWeight="700">
        {cardDuration(data.totalDurationMs)}
      </text>
      <text x="186" y={footer + 62} fill="var(--fp-card-muted)" fontSize="10.5">
        陪伴时长
      </text>
      <text
        x="436"
        y={footer + 40}
        textAnchor="end"
        fill="var(--fp-card-ink)"
        fontSize="15.5"
        fontWeight="650"
      >
        {clip(data.highlight?.title || '—', 6)}
      </text>
      <text x="436" y={footer + 62} textAnchor="end" fill="var(--fp-card-muted)" fontSize="10.5">
        听得最多{data.highlight ? ` · ${data.highlight.plays} 次` : ''}
      </text>
      <text x="44" y={footer + 92} fill="var(--fp-card-muted)" fontSize="9" letterSpacing="2.2">
        OPEN MUSIC CLUB
      </text>
      <text x="436" y={footer + 92} textAnchor="end" fill="var(--fp-card-muted)" fontSize="9.5">
        听歌回忆
      </text>
    </svg>
  );
});

// 只序列化本组件产生的 SVG，并将站点主题令牌固化到可离线打开的文件。
export function downloadCardArtwork(svg: SVGSVGElement, title: string) {
  const xml = serializeCardArtwork(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '_') || '音乐足迹'}.svg`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
