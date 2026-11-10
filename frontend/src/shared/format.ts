function formatParts(minutes: number, seconds: number): string {
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// 保留专辑汇总的既有秒数精度；调用方负责输入校验与取整策略。
export function formatDurationSeconds(seconds: number): string {
  return formatParts(Math.floor(seconds / 60), seconds % 60);
}

export function formatDurationMs(milliseconds: number): string {
  return formatDurationSeconds(Math.floor(milliseconds / 1000));
}

export function formatPlaybackTime(seconds: number): string {
  return Number.isFinite(seconds)
    ? formatParts(Math.floor(seconds / 60), Math.floor(seconds % 60))
    : '0:00';
}

// 足迹继续截断负时长；保留原毫秒除法顺序，不改变边界输入的输出。
export function formatTrackDuration(milliseconds: number): string {
  const value = Math.max(0, milliseconds);
  return formatParts(Math.floor(value / 60000), Math.floor(value / 1000) % 60);
}
