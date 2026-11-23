export interface ArchiveRecord {
  id: string;
  category: string;
  albumIndex: number;
}

export interface ArchiveAlbumPreferences {
  favoriteAlbumIds?: readonly string[];
  recentAlbumIds?: readonly string[];
}

// 排序只依赖专辑 ID；未来收藏和最近播放接入时，无需改动三维模型。
export function rankArchiveAlbums(
  albums: readonly { id: string }[],
  preferences: ArchiveAlbumPreferences = {},
): number[] {
  const indexById = new Map(albums.map((album, index) => [album.id, index]));
  const ranked: number[] = [];
  const seen = new Set<number>();
  for (const id of [
    ...(preferences.favoriteAlbumIds ?? []),
    ...(preferences.recentAlbumIds ?? []),
  ]) {
    const index = indexById.get(id);
    if (index !== undefined && !seen.has(index)) {
      ranked.push(index);
      seen.add(index);
    }
  }
  albums.forEach((_, index) => {
    if (!seen.has(index)) ranked.push(index);
  });
  return ranked;
}

// 原 24 张保持原索引和位置，个人专辑从每列第九格起轮流接入。
export const archiveColumns = Array.from({ length: 3 }, (_, lane) => `专辑列 ${lane + 1}`);
export const RECOMMENDED_ALBUM_COUNT = 24;
export const ARCHIVE_START_ROW = 12;

export interface ArchiveLayout {
  records: ArchiveRecord[];
  columns: number[][];
  locations: { lane: number; row: number; slot: number }[];
  rowPeriod: number;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function createArchiveLayout(personalCount = 0): ArchiveLayout {
  const records: ArchiveRecord[] = [];
  const columns: number[][] = archiveColumns.map(() => []);
  const locations: ArchiveLayout['locations'] = [];
  function append(lane: number, albumIndex: number) {
    const index = records.length;
    const row = ARCHIVE_START_ROW + columns[lane].length;
    records.push({
      id: `${lane + 1}-${row - ARCHIVE_START_ROW + 1}`,
      category: archiveColumns[lane],
      albumIndex,
    });
    columns[lane].push(index);
    const slot = row < 32 ? lane * 32 + row : (row - 32) * columns.length + 96 + lane;
    locations.push({ lane, row, slot });
  }
  for (let lane = 0; lane < columns.length; lane++) {
    for (let row = 0; row < 8; row++) append(lane, ((lane + 1) % 3) * 8 + row);
  }
  for (let index = 0; index < personalCount; index++) {
    append(index % columns.length, RECOMMENDED_ALBUM_COUNT + index);
  }
  const rowPeriod = columns.reduce(
    (period, files) => (period / gcd(period, files.length)) * files.length,
    1,
  );
  return { records, columns, locations, rowPeriod };
}

export const archiveLayout = createArchiveLayout();
export const { records } = archiveLayout;

export function columnFiles(lane: number, layout = archiveLayout) {
  return layout.columns[lane];
}

export function fileLocation(index: number, layout = archiveLayout) {
  return layout.locations[index];
}

export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
