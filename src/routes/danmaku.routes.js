const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const { createDanmakuMediaGuard } = require('../middleware/danmakuMediaGuard')
const {
  DanmakuError,
  MEDIA_FILE,
  MEDIA_URL_PREFIX,
  createDanmakuService,
} = require('../services/danmaku.service')

// 媒体文件按扩展名给出响应类型；只服务上传接口生成的白名单格式。
const CONTENT_TYPES = new Map([
  ['.webm', 'audio/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'],
  ['.wav', 'audio/wav'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

function mediaKindOf(extension) {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension) ? 'image' : 'voice'
}

function createDanmakuRouter({ database, mediaDirectory }) {
  const router = express.Router()
  const service = createDanmakuService({ database })
  const directory = mediaDirectory || path.resolve('storage/danmaku')
  const mediaGuard = createDanmakuMediaGuard(directory)

  // 弹幕是实时互动内容，任何一层缓存都会让新弹幕晚到；媒体文件本身不可变，单独长缓存。
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  function handle(action) {
    return async (req, res, next) => {
      try {
        return await action(req, res, next)
      } catch (error) {
        if (error instanceof DanmakuError) {
          return res.status(error.status).json({ success: false, message: error.message })
        }
        return next(error)
      }
    }
  }

  // 拉取一首歌的弹幕时间轴；afterId 用于轮询增量拉新弹幕。
  router.get('/danmaku', handle((req, res) => {
    const payload = service.list({
      source: req.query.source,
      sourceId: req.query.sourceId,
      afterId: req.query.afterId,
      limit: req.query.limit,
    })
    return res.json({ success: true, ...payload })
  }))

  // 全站实时弹幕流：跨歌曲的最新弹幕，afterId 用于轮询增量拉新。
  router.get('/danmaku/recent', handle((req, res) => {
    const payload = service.recent({ afterId: req.query.afterId, limit: req.query.limit })
    return res.json({ success: true, ...payload })
  }))

  // 语音/图片弹幕先上传媒体，拿到文件名后再带着它发送弹幕。
  router.post('/danmaku/media', mediaGuard, handle((req, res) => {
    if (!req.file) throw new DanmakuError('请选择要发送的语音或图片', 400)
    const extension = path.extname(req.file.filename).toLowerCase()
    const durationMs = Number(req.body?.durationMs) || 0
    return res.status(201).json({
      success: true,
      media: {
        path: req.file.filename,
        kind: mediaKindOf(extension),
        durationMs: Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0,
        url: `${MEDIA_URL_PREFIX}${req.file.filename}`,
      },
    })
  }))

  // 读取弹幕媒体；文件名必须是上传接口生成的 UUID 形式，避免目录穿越。
  router.get('/danmaku/media/:name', handle((req, res, next) => {
    const name = String(req.params.name || '')
    if (!MEDIA_FILE.test(name)) {
      return res.status(400).json({ success: false, message: '媒体地址无效' })
    }
    const filePath = path.join(directory, name)
    let stats
    try {
      stats = fs.statSync(filePath)
    } catch {
      return res.status(404).json({ success: false, message: '媒体文件不存在' })
    }
    res.set({
      'Content-Type': CONTENT_TYPES.get(path.extname(name).toLowerCase()) || 'application/octet-stream',
      'Content-Length': String(stats.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    const stream = fs.createReadStream(filePath)
    stream.on('error', next)
    return stream.pipe(res)
  }))

  // 发送弹幕：记录当前播放进度，别人听到同一进度时会准时飘出这条弹幕。
  // kind 为 text / voice / image；语音和图片需要先调用 /danmaku/media 上传。
  router.post('/danmaku', handle(async (req, res) => {
    const message = await service.send({
      userId: req.user.id,
      nickname: req.user.nickname,
      track: req.body?.track,
      content: req.body?.content,
      positionMs: req.body?.positionMs,
      durationMs: req.body?.durationMs,
      kind: req.body?.kind,
      mediaPath: req.body?.mediaPath,
      mediaDurationMs: req.body?.mediaDurationMs,
    })
    return res.status(201).json({ success: true, message })
  }))

  // 只能撤回自己发送的弹幕。
  router.delete('/danmaku/:id', handle((req, res) => {
    return res.json({ success: true, ...service.remove({ userId: req.user.id, id: req.params.id }) })
  }))

  return router
}

module.exports = { createDanmakuRouter }
