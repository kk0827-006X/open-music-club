const PICTURE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

async function readMusicMetadata(filePath) {
  const { parseFile } = await import('music-metadata')
  const metadata = await parseFile(filePath)
  const common = metadata.common || {}
  const format = metadata.format || {}
  const picture = Array.isArray(common.picture) ? common.picture[0] : null
  const pictureMimeType = picture?.format?.toLowerCase()

  return {
    title: common.title || '',
    artist: common.artist || common.albumartist || '',
    album: common.album || '',
    durationMs: Number.isFinite(format.duration)
      ? Math.max(0, Math.round(format.duration * 1000))
      : 0,
    container: format.container || '',
    picture:
      picture && PICTURE_TYPES.has(pictureMimeType)
        ? {
            data: Buffer.from(picture.data),
            mimeType: pictureMimeType,
            extension: PICTURE_TYPES.get(pictureMimeType),
          }
        : null,
  }
}

module.exports = {
  readMusicMetadata,
}
