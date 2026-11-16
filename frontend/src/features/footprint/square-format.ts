import { formatDate } from './format.ts';

export function authorColor(nickname: string) {
  let hash = 0;
  for (const character of nickname) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % 5;
}

export function relativePostTime(value: string, offset: number, now = Date.now()) {
  const raw = value.trim().replace(' ', 'T');
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(timestamp)) return '未知日期';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} 天前`;
  return formatDate(value, offset);
}
