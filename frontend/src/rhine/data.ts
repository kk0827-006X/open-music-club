import { demoAlbums } from '../album-data.ts'

export interface ArchiveRecord {
  id: string
  title: string
  category: string
  albumIndex: number
}

export interface ArchiveAlbumPreferences {
  favoriteAlbumIds?: readonly string[]
  recentAlbumIds?: readonly string[]
}

// 排序只依赖专辑 ID；未来收藏和最近播放接入时，无需改动三维模型。
export function rankArchiveAlbums(
  albums: readonly { id: string }[],
  preferences: ArchiveAlbumPreferences = {},
): number[] {
  const indexById = new Map(albums.map((album, index) => [album.id, index]))
  const ranked: number[] = []
  const seen = new Set<number>()
  for (const id of [...(preferences.favoriteAlbumIds ?? []), ...(preferences.recentAlbumIds ?? [])]) {
    const index = indexById.get(id)
    if (index !== undefined && !seen.has(index)) {
      ranked.push(index)
      seen.add(index)
    }
  }
  albums.forEach((_, index) => {
    if (!seen.has(index)) ranked.push(index)
  })
  return ranked
}

// 保持原档案墙的循环交互，把 24 张专辑映射为三列、每列八格。
export const archiveColumns = Array.from({ length: 3 }, (_, lane) => `专辑列 ${lane + 1}`)
const albumOrder = rankArchiveAlbums(demoAlbums)
export const records: ArchiveRecord[] = archiveColumns.flatMap((category, lane) =>
  Array.from({ length: 8 }, (_, row) => {
    const albumIndex = albumOrder[((lane + 1) % 3) * 8 + row]
    return {
      id: `${lane + 1}-${row + 1}`,
      title: demoAlbums[albumIndex].title,
      category,
      albumIndex,
    }
  }),
)

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index)
}

export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category)
  const row = 12 + columnFiles(lane).indexOf(index)
  return { lane, row, slot: lane * 32 + row }
}

export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32))
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))]
}
