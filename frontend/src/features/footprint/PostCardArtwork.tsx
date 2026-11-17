import { useId } from 'react';
import type { FootprintPostCard } from '../../services/music/footprint.ts';
import { CardBackdrop } from './CardBackdrop.tsx';
import { formatDate, formatDuration } from './format.ts';

const clip = (text: string, limit: number) =>
  Array.from(text).length > limit ? `${Array.from(text).slice(0, limit).join('')}…` : text;

// 分享摘要专用缩略图，复用卡片背景，不携带或请求私人随笔。
export function PostCardArtwork({ card, offset }: { card: FootprintPostCard; offset: number }) {
  const uid = `post-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className="fp-card-art fp-post-art"
      data-card-palette={card.style}
      viewBox="0 0 360 430"
      role="img"
      aria-label={`${card.title}，回忆卡片缩略图`}
      fontFamily="Helvetica, Arial, sans-serif"
    >
      <CardBackdrop uid={uid} width={360} height={430} />
      <rect
        x="12"
        y="12"
        width="336"
        height="406"
        rx="13"
        fill="none"
        stroke="var(--fp-card-white)"
        strokeOpacity=".7"
        strokeWidth="1.4"
      />
      <rect
        x="19"
        y="19"
        width="322"
        height="392"
        rx="9"
        fill="none"
        stroke="var(--fp-card-accent)"
        strokeOpacity=".18"
      />
      <circle cx="30" cy="46" r="2.8" fill="var(--fp-card-accent)" />
      <text
        x="40"
        y="49.5"
        fill="var(--fp-card-accent)"
        fontSize="8.5"
        letterSpacing="3.4"
        fontWeight="600"
      >
        MUSIC FOOTPRINT
      </text>
      <text x="336" y="66" textAnchor="end" fill="var(--fp-card-muted)" fontSize="9">
        {formatDate(card.period.from, offset)} — {formatDate(card.period.to, offset)}
      </text>
      <text x="24" y="96" fill="var(--fp-card-ink)" fontSize="20" fontWeight="700">
        {clip(card.title, 14)}
      </text>
      <line x1="24" y1="112" x2="336" y2="112" stroke="var(--fp-card-accent)" strokeOpacity=".26" />
      <text x="24" y="176" fill="var(--fp-card-ink)" fontSize="48" fontWeight="700">
        {card.trackCount}
      </text>
      <text x="24" y="198" fill="var(--fp-card-muted)" fontSize="10.5">
        段声音 · {formatDuration(card.totalDurationMs)}
      </text>
      {card.highlight && (
        <>
          <text x="24" y="242" fill="var(--fp-card-accent)" fontSize="9" letterSpacing="2">
            循环最多
          </text>
          <text x="24" y="268" fill="var(--fp-card-ink)" fontSize="15.5" fontWeight="650">
            {clip(card.highlight.title, 13)}
          </text>
          <text x="24" y="288" fill="var(--fp-card-muted)" fontSize="10.5">
            {clip(card.highlight.artist, 17)} · {card.highlight.plays} 次
          </text>
        </>
      )}
      {card.tracks.slice(0, 2).map((track, index) => (
        <g key={index}>
          <rect
            x="24"
            y={320 + index * 34}
            width={Math.min(276, 34 + Array.from(track.title).length * 12)}
            height="26"
            rx="13"
            fill="var(--fp-card-chip)"
            stroke="var(--fp-card-accent)"
            strokeOpacity=".2"
          />
          <text x="38" y={337 + index * 34} fill="var(--fp-card-ink)" fontSize="11.5">
            {clip(track.title, 16)}
          </text>
        </g>
      ))}
      <text
        x="336"
        y="398"
        textAnchor="end"
        fill="var(--fp-card-muted)"
        fontSize="8.5"
        letterSpacing="2"
      >
        OPEN MUSIC CLUB
      </text>
    </svg>
  );
}
