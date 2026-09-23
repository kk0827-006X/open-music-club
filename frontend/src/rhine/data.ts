import { demoAlbums } from '../album-data.ts'

export interface ArchiveRecord {
  id: string
  title: string
  category: string
  albumIndex: number
}

// 保持原档案墙的五列、每列八格循环布局，只替换格位承载的专辑素材。
export const archiveColumns = Array.from({ length: 5 }, (_, lane) => `专辑列 ${lane + 1}`)
export const records: ArchiveRecord[] = archiveColumns.flatMap((category, lane) =>
  Array.from({ length: 8 }, (_, row) => {
    const albumIndex = (lane + row + 3) % demoAlbums.length
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
