// 弹幕媒体上传守卫：语音（webm/mp3/ogg/m4a/wav）与图片（jpg/png/webp/gif）各一份白名单。
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const multer = require('multer')

const MEDIA_FORMATS = new Map([
  ['.webm', new Set(['audio/webm', 'video/webm'])],
  ['.mp3', new Set(['audio/mpeg', 'audio/mp3'])],
  ['.ogg', new Set(['audio/ogg', 'application/ogg'])],
  ['.m4a', new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a'])],
  ['.wav', new Set(['audio/wav', 'audio/x-wav', 'audio/wave'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.webp', new Set(['image/webp'])],
  ['.gif', new Set(['image/gif'])],
])

const MAXIMUM_MEDIA_BYTES = 8 * 1024 * 1024

class MediaValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function isAllowedMedia(extension, mimeType) {
  return MEDIA_FORMATS.get(extension)?.has(mimeType) === true
}

function createDanmakuMediaGuard(directory, { maximumBytes = MAXIMUM_MEDIA_BYTES } = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const upload = multer({
    storage: multer.diskStorage({
      destination: directory,
      filename(req, file, callback) {
        callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
      },
    }),
    limits: { fileSize: maximumBytes, files: 1, fields: 8, fieldSize: 2048, parts: 10 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase()
      if (!isAllowedMedia(extension, file.mimetype)) {
        return callback(new MediaValidationError('只支持语音和图片格式的弹幕'))
      }
      return callback(null, true)
    },
  }).single('file')

  return function danmakuMediaGuard(req, res, next) {
    upload(req, res, (error) => {
      if (!error) return next()
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: '媒体文件过大，语音请控制在 60 秒内' })
      }
      if (error instanceof MediaValidationError || error instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: error.message || '上传内容无效' })
      }
      return next(error)
    })
  }
}

module.exports = {
  MAXIMUM_MEDIA_BYTES,
  MediaValidationError,
  createDanmakuMediaGuard,
  isAllowedMedia,
}
