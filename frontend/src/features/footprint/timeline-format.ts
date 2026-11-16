import { dayKey, formatDate } from './format.ts';

// 日期分组与相对日期共用站点时区，不依赖浏览器所在地。
export function timelineDayLabel(value: string, offset: number, now = Date.now()) {
  const key = dayKey(value, offset);
  if (key === dayKey(new Date(now).toISOString(), offset)) return '今天';
  if (key === dayKey(new Date(now - 86400000).toISOString(), offset)) return '昨天';
  return formatDate(value, offset);
}
