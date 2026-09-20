const path = require('node:path')
const { randomUUID } = require('node:crypto')
const multer = require('multer')
const { isAllowedUpload } = require('../config/localMusic')

class UploadValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

function createUploadGuard(config) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.temporaryDirectory,
      filename(req, file, callback) {
        callback(null, randomUUID())
      },
    }),
    limits: {
      fileSize: config.maximumUploadBytes,
      files: 1,
      fields: 16,
      fieldSize: 4096,
      parts: 18,
    },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase()
      if (!isAllowedUpload(extension, file.mimetype)) {
        return callback(new UploadValidationError('不支持的音乐文件格式'))
      }
      return callback(null, true)
    },
  }).single('file')

  return function uploadGuard(req, res, next) {
    upload(req, res, (error) => {
      if (!error) return next()
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: '上传文件过大' })
      }
      if (
        error instanceof UploadValidationError ||
        error instanceof multer.MulterError
      ) {
        return res.status(400).json({
          success: false,
          message: error.message || '上传内容无效',
        })
      }
      return next(error)
    })
  }
}

module.exports = {
  UploadValidationError,
  createUploadGuard,
}
