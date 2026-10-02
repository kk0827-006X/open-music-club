const express = require('express')
const multer = require('multer')
const sharp = require('sharp')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const formats = {
  'image/jpeg': { format: 'jpeg', extensions: ['.jpg', '.jpeg'] },
  'image/png': { format: 'png', extensions: ['.png'] },
  'image/webp': { format: 'webp', extensions: ['.webp'] },
}

function signatureMatches(buffer, format) {
  if (format === 'jpeg') return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (format === 'png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
}

function createUserProfileRouter(database) {
  const router = express.Router()
  const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
    fileFilter(req, file, callback) {
      const format = formats[file.mimetype]
      const valid = format && format.extensions.includes(path.extname(file.originalname).toLowerCase())
      callback(valid ? null : new Error('头像格式不支持'), Boolean(valid))
    },
  }).single('file')
  const read = (userId) => database.prepare('SELECT avatar_version FROM user_profiles WHERE user_id = ?').get(userId)
  const profile = (user, row) => ({ id: user.id, nickname: user.nickname,
    avatarUrl: row ? `/api/me/avatar?v=${row.avatar_version}` : null })

  router.get('/profile', (req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ success: true, profile: profile(req.user, read(req.user.id)) })
  })
  router.get('/avatar', (req, res) => {
    const row = database.prepare('SELECT avatar_data FROM user_profiles WHERE user_id = ?').get(req.user.id)
    if (!row) return res.status(404).json({ success: false, message: '尚未设置头像' })
    return res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(row.avatar_data)
  })
  router.put('/avatar', (req, res, next) => upload(req, res, async (error) => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      .json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? '头像不能超过 5 MB' : '请选择一张 JPG、PNG 或 WebP 图片' })
    if (!req.file) return res.status(400).json({ success: false, message: '请选择头像图片' })
    let avatar
    try {
      const format = formats[req.file.mimetype].format
      if (!signatureMatches(req.file.buffer, format)) throw new Error('文件签名不匹配')
      const image = sharp(req.file.buffer, { limitInputPixels: 16_000_000, failOn: 'warning' })
      const metadata = await image.metadata()
      if (metadata.format !== format || (metadata.pages || 1) !== 1) throw new Error('图片格式不匹配')
      // 重新编码仅保留像素，剥离原始元数据；小尺寸头像不占用音乐文件存储。
      avatar = await image.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      if (avatar.length > 262144) throw new Error('转码后的头像过大')
    } catch {
      return res.status(400).json({ success: false, message: '图片无法读取或尺寸过大，请选择其他图片' })
    }
    try {
      const version = randomUUID()
      database.prepare(`INSERT INTO user_profiles (user_id, avatar_data, avatar_version) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET avatar_data = excluded.avatar_data,
        avatar_version = excluded.avatar_version, updated_at = CURRENT_TIMESTAMP`).run(req.user.id, avatar, version)
      return res.json({ success: true, profile: profile(req.user, { avatar_version: version }) })
    } catch (error) { return next(error) }
  }))
  return router
}

module.exports = { createUserProfileRouter }
