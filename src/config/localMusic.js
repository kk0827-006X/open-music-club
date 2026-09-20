const path = require('node:path')

const AUDIO_FORMATS = new Map([
  ['.mp3', new Set(['audio/mpeg', 'audio/mp3'])],
  ['.flac', new Set(['audio/flac', 'audio/x-flac'])],
  ['.wav', new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])],
  ['.m4a', new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a'])],
  ['.ogg', new Set(['audio/ogg', 'application/ogg'])],
])

const CONTAINER_PATTERNS = new Map([
  ['.mp3', /mpeg/i],
  ['.flac', /flac/i],
  ['.wav', /wave|wav/i],
  ['.m4a', /m4a|mp4|isom|quicktime/i],
  ['.ogg', /ogg/i],
])

function parseMaximumUploadMegabytes(value = 100) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('MAX_UPLOAD_MB 必须是正数')
  }
  return parsed
}

function createLocalMusicConfig({
  storageRoot = path.resolve('storage'),
  maximumUploadMegabytes = process.env.MAX_UPLOAD_MB || 100,
} = {}) {
  const maximum = parseMaximumUploadMegabytes(maximumUploadMegabytes)
  const resolvedStorageRoot = path.resolve(storageRoot)
  return {
    storageRoot: resolvedStorageRoot,
    musicDirectory: path.join(resolvedStorageRoot, 'music'),
    coversDirectory: path.join(resolvedStorageRoot, 'covers'),
    temporaryDirectory: path.join(resolvedStorageRoot, 'temp'),
    maximumUploadBytes: Math.floor(maximum * 1024 * 1024),
  }
}

function isAllowedUpload(extension, mimeType) {
  return AUDIO_FORMATS.get(extension)?.has(mimeType) === true
}

function matchesDetectedContainer(extension, container) {
  if (typeof container !== 'string' || !container.trim()) return false
  return CONTAINER_PATTERNS.get(extension)?.test(container) === true
}

module.exports = {
  AUDIO_FORMATS,
  createLocalMusicConfig,
  isAllowedUpload,
  matchesDetectedContainer,
  parseMaximumUploadMegabytes,
}
