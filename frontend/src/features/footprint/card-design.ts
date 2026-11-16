import type { MemoryCard } from '../../services/music/footprint.ts';
import { formatClock } from './format.ts';

type CardData = Pick<MemoryCard, 'title' | 'data'>;

// 沿用来源设计的时段配色；按本站偏移读取时间，不受浏览器时区影响。
export function cardPalette(card: CardData, offset: number) {
  if (card.data.style && card.data.style !== 'auto') return card.data.style;
  const hours = card.data.tracks
    .map((track) => formatClock(track.playedAt, offset))
    .filter((clock) => clock !== '—')
    .map((clock) => Number(clock.slice(0, 2)));
  if (!hours.length) return 'amber';
  const average = hours.reduce((sum, hour) => sum + hour, 0) / hours.length;
  if (average >= 21 || average < 5) return 'sky';
  if (average < 10) return 'mint';
  if (average < 14) return 'butter';
  if (average < 17) return 'peach';
  return 'lilac';
}

// 复现原卡片的内容密度、随笔留白及 500–740 高度范围。
export function cardLayout(card: CardData) {
  const notes = card.data.notes.slice(0, 2);
  const tracks = card.data.tracks.slice(0, notes.length ? 5 : 6);
  const dense = tracks.length > 4;
  const step = dense ? 42 : tracks.length > 2 ? 50 : 62;
  const noteSize = dense ? 12.5 : 14;
  const contentHeight =
    tracks.length * step + (notes.length ? 8 + notes.length * (noteSize + 12) : 0);
  const needed = 232 + contentHeight + 46 + 132;
  const height = Math.min(740, Math.max(500, needed));
  const characters = Array.from(card.title.trim() || '我的听歌回忆');
  const titleLines = [characters.slice(0, 14).join('')];
  if (characters.length > 14) {
    titleLines.push(characters.slice(14, 28).join('') + (characters.length > 28 ? '…' : ''));
  }
  return {
    tracks,
    notes,
    step,
    noteSize,
    height,
    titleLines,
    titleSize: dense ? 14.5 : tracks.length > 2 ? 16.5 : 19,
    artistSize: dense ? 11.5 : tracks.length > 2 ? 12.5 : 13.5,
    badgeRadius: dense ? 11 : tracks.length > 2 ? 12 : 14,
    listTop: 232 + (height - needed) / 2,
    footer: height - 132,
  };
}

export function cardDuration(ms: number) {
  const minutes = Math.max(1, Math.round((Number(ms) || 0) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}
