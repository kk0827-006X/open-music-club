const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { matchesDetectedContainer } = require('../config/localMusic')
const {
  createMusic,
  deleteMusicRecord,
  findMusicById,
  listMusic,
  recordDownload,
  toTrack,
} = require('../db/localMusic')
const { readMusicMetadata } = require('./metadata.service')

class LocalMusicError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeFilenameBase(filename) {
  return path.basename(filename, path.extname(filename)).trim()
}

function resolveStoredPath(storageRoot, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new LocalMusicError('音乐文件不存在', 404)
  }
  const root = path.resolve(storageRoot)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new LocalMusicError('音乐文件不存在', 404)
  }
  return resolved
}

function removeIfExists(filePath) {
  if (!filePath) return
  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
  }
}

function requireExistingFile(filePath) {
  let stats
  try {
    stats = fs.statSync(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new LocalMusicError('音乐文件不存在', 404)
    }
    throw error
  }
  if (!stats.isFile()) throw new LocalMusicError('音乐文件不存在', 404)
  return stats
}

function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match || (!match[1] && !match[2]) || fileSize <= 0) return false

  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : fileSize - 1
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= fileSize ||
      start > end
    ) {
      return false
    }
    end = Math.min(end, fileSize - 1)
  }
  return { start, end }
}

function createLocalMusicService({ database, config, metadataReader }) {
  for (const directory of [
    config.musicDirectory,
    config.coversDirectory,
    config.temporaryDirectory,
  ]) {
    fs.mkdirSync(directory, { recursive: true })
  }

  const readMetadata = metadataReader || readMusicMetadata

  async function uploadMusic({ file, fields, uploaderId }) {
    if (!file) throw new LocalMusicError('请选择音乐文件')

    const extension = path.extname(file.originalname).toLowerCase()
    let finalMusicPath
    let finalCoverPath
    try {
      let metadata
      try {
        metadata = await readMetadata(file.path)
      } catch (error) {
        throw new LocalMusicError('无法读取音乐 Metadata')
      }
      if (
        !metadata ||
        !matchesDetectedContainer(extension, metadata.container)
      ) {
        throw new LocalMusicError('音乐文件内容与格式不匹配')
      }

      const storedFilename = `${randomUUID()}${extension}`
      const filePath = path.posix.join('music', storedFilename)
      finalMusicPath = resolveStoredPath(config.storageRoot, filePath)

      let coverFilename = null
      let coverPath = null
      let coverMimeType = null
      if (metadata.picture) {
        const allowedPictures = new Map([
          ['image/jpeg', '.jpg'],
          ['image/png', '.png'],
          ['image/webp', '.webp'],
        ])
        const coverExtension = allowedPictures.get(metadata.picture.mimeType)
        if (coverExtension && Buffer.isBuffer(metadata.picture.data)) {
          coverFilename = `${randomUUID()}${coverExtension}`
          coverPath = path.posix.join('covers', coverFilename)
          coverMimeType = metadata.picture.mimeType
          finalCoverPath = resolveStoredPath(config.storageRoot, coverPath)
          fs.writeFileSync(finalCoverPath, metadata.picture.data, { flag: 'wx' })
        }
      }

      fs.renameSync(file.path, finalMusicPath)
      const title =
        cleanText(fields.title) ||
        cleanText(metadata.title) ||
        safeFilenameBase(file.originalname) ||
        '未命名音乐'
      const artist =
        cleanText(fields.artist) || cleanText(metadata.artist) || '未知艺术家'
      const album = cleanText(fields.album) || cleanText(metadata.album) || null

      const music = createMusic(database, {
        title,
        artist,
        album,
        originalFilename: path.basename(file.originalname),
        storedFilename,
        filePath,
        coverFilename,
        coverPath,
        coverMimeType,
        mimeType: file.mimetype,
        fileSize: file.size,
        durationMs: Number.isFinite(metadata.durationMs)
          ? Math.max(0, Math.round(metadata.durationMs))
          : 0,
        uploaderId,
      })
      return toTrack(music)
    } catch (error) {
      removeIfExists(file.path)
      removeIfExists(finalMusicPath)
      removeIfExists(finalCoverPath)
      throw error
    }
  }

  function getMusic(id) {
    return findMusicById(database, id)
  }

  function getTrack(id) {
    const music = getMusic(id)
    if (!music) throw new LocalMusicError('音乐不存在', 404)
    return toTrack(music)
  }

  function getTracks() {
    return listMusic(database).map(toTrack)
  }

  function getFile(id, type = 'music') {
    const music = getMusic(id)
    if (!music) throw new LocalMusicError('音乐不存在', 404)
    const relativePath = type === 'cover' ? music.cover_path : music.file_path
    if (!relativePath) throw new LocalMusicError('封面不存在', 404)
    const filePath = resolveStoredPath(config.storageRoot, relativePath)
    const stats = requireExistingFile(filePath)
    return { music, filePath, stats }
  }

  function registerDownload(musicId, userId) {
    recordDownload(database, musicId, userId)
  }

  function deleteMusic(id, user) {
    const music = getMusic(id)
    if (!music) throw new LocalMusicError('音乐不存在', 404)
    if (music.uploader_id !== user.id && user.role !== 'admin') {
      throw new LocalMusicError('无权删除这首音乐', 403)
    }

    const stagedFiles = []
    try {
      for (const relativePath of [music.file_path, music.cover_path]) {
        if (!relativePath) continue
        const source = resolveStoredPath(config.storageRoot, relativePath)
        try {
          requireExistingFile(source)
        } catch (error) {
          if (error.status === 404) continue
          throw error
        }
        const staged = path.join(
          config.temporaryDirectory,
          `deleting-${randomUUID()}`,
        )
        fs.renameSync(source, staged)
        stagedFiles.push({ source, staged })
      }

      deleteMusicRecord(database, id)
    } catch (error) {
      for (const { source, staged } of stagedFiles.reverse()) {
        if (fs.existsSync(staged)) fs.renameSync(staged, source)
      }
      throw error
    }

    for (const { staged } of stagedFiles) removeIfExists(staged)
  }

  return {
    deleteMusic,
    getFile,
    getTrack,
    getTracks,
    parseRange,
    registerDownload,
    uploadMusic,
  }
}

module.exports = {
  LocalMusicError,
  createLocalMusicService,
  parseRange,
  resolveStoredPath,
}
