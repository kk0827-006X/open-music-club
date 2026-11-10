import { FALLBACK_COVER } from '../music.ts';

// 占位图本身加载失败时不再次赋值，避免触发连续错误事件。
export function replaceBrokenCover(event: { currentTarget: HTMLImageElement }) {
  const image = event.currentTarget;
  if (!image.src.endsWith('album-placeholder-01.svg')) image.src = FALLBACK_COVER;
}
