export type UploadMetadata = {
  title: string
  artist: string
  album: string
  cover: Blob | null
}

const EMPTY_METADATA: UploadMetadata = { title: '', artist: '', album: '', cover: null }
const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_COVER_BYTES = 10 * 1024 * 1024

export async function readUploadMetadata(file: Blob): Promise<UploadMetadata> {
  try {
    const { parseBlob } = await import('music-metadata')
    const { common } = await parseBlob(file)
    const picture = common.picture?.[0]
    const type = picture?.format?.toLowerCase() || ''
    const cover = picture && COVER_TYPES.has(type) && picture.data.length <= MAX_COVER_BYTES
      ? new Blob([new Uint8Array(picture.data)], { type })
      : null

    return {
      title: common.title?.trim() || '',
      artist: (common.artist || common.albumartist)?.trim() || '',
      album: common.album?.trim() || '',
      cover,
    }
  } catch {
    // 标签读取失败只影响自动填充，上传仍由服务器复核。
    return { ...EMPTY_METADATA }
  }
}
