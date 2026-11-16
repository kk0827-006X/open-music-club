const express = require('express')
const { DanmakuError, createDanmakuService } = require('../services/danmaku.service')

function createDanmakuRouter({ database }) {
  const router = express.Router()
  const service = createDanmakuService({ database })

  // 弹幕墙是实时互动内容，任何一层缓存都会让新弹幕晚到。
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  function handle(action) {
    return async (req, res, next) => {
      try {
        return await action(req, res)
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

  // 发送弹幕：记录当前播放进度，别人听到同一进度时会准时飘出这条弹幕。
  router.post('/danmaku', handle(async (req, res) => {
    const message = await service.send({
      userId: req.user.id,
      nickname: req.user.nickname,
      track: req.body?.track,
      content: req.body?.content,
      positionMs: req.body?.positionMs,
      durationMs: req.body?.durationMs,
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
