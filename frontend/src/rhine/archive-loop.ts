import { archiveLayout, ARCHIVE_START_ROW, columnFiles, fileLocation } from './data.ts';

export type ArchiveCell = { lane: number; row: number };
type ArchiveDirection = { axis: 'row' | 'lane'; direction: number };
export type ArchiveNavigation =
  ArchiveDirection | { cell: ArchiveCell } | { jump: ArchiveDirection };
const directions: readonly ArchiveDirection[] = [
  { axis: 'row', direction: -1 },
  { axis: 'row', direction: 1 },
  { axis: 'lane', direction: -1 },
  { axis: 'lane', direction: 1 },
];

export function randomArchiveJump(): ArchiveNavigation {
  return { jump: directions[Math.floor(Math.random() * directions.length)] };
}

export const LOOP_COLUMNS = 9;
export const LOOP_ROWS = 32;
export const COLUMN_SPACING = 5.2;
export const ROW_SPACING = 0.62;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];

export function wrap(value: number, count: number) {
  return ((value % count) + count) % count;
}

// Choose an occurrence of an item in an unbounded sequence. Directional moves
// use adjacent cells instead, so the last-to-first transition never reverses.
export function nearestOccurrence(value: number, center: number, period: number) {
  return value + Math.floor((center - value + period / 2) / period) * period;
}

function directedOccurrence(value: number, center: number, period: number, direction: number) {
  const distance = (center - value) / period;
  const cycle = direction > 0 ? Math.floor(distance) + 1 : Math.ceil(distance) - 1;
  return value + cycle * period;
}

export function fileAtCell({ lane, row }: ArchiveCell, layout = archiveLayout) {
  const files = columnFiles(wrap(lane, layout.columns.length), layout);
  return files[wrap(row - ARCHIVE_START_ROW, files.length)];
}

export function selectionCell(
  index: number,
  current: ArchiveCell,
  navigation?: ArchiveNavigation,
  layout = archiveLayout,
): ArchiveCell {
  if (navigation && 'cell' in navigation) return { ...navigation.cell };
  const next = fileLocation(index, layout);
  const rows = columnFiles(next.lane, layout).length;
  const row = nearestOccurrence(next.row, current.row, rows);
  const lanes = layout.columns.length;
  const lane = nearestOccurrence(next.lane, current.lane, lanes);
  if (navigation && 'jump' in navigation) {
    // 与方向键使用同一套轨道和阻尼；用循环中的同一档案保证任意方向都能到位。
    const { axis, direction } = navigation.jump;
    return axis === 'row'
      ? { lane, row: directedOccurrence(next.row, current.row, rows, direction) }
      : { lane: directedOccurrence(next.lane, current.lane, lanes, direction), row };
  }
  if (navigation?.axis === 'row') {
    return { lane: current.lane, row: current.row + navigation.direction };
  }
  return {
    lane: navigation?.axis === 'lane' ? current.lane + navigation.direction : lane,
    row,
  };
}

// Preserve the reference animation's original first 160 instances. The four
// extra columns form a hidden margin on either side during interactive use.
export function poolCell(index: number): ArchiveCell {
  return {
    lane: POOL_LANES[Math.floor(index / LOOP_ROWS)],
    row: index % LOOP_ROWS,
  };
}

export function cellKey(cell: ArchiveCell) {
  return `${cell.lane}:${cell.row}`;
}

export function sameCell(a: ArchiveCell, b: ArchiveCell) {
  return a.lane === b.lane && a.row === b.row;
}
