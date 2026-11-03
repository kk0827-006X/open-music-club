const express = require('express')
const { BlindBoxError, createBlindBoxService } = require('../services/blindBox.service')

function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return null
  return Number(text)
}

function parsePage(query) {
  const limit = query.limit === undefined ? 12 : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return null
  return { limit, offset }
}

function failure(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function createBlindBoxRouter({ database, neteaseService }) {
  const router = express.Router()
  const service = createBlindBoxService({ database, neteaseService })

  // 盲盒内容是随机的，任何一层缓存都会让「再抽一次」拿到同一批歌。
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  function handle(action) {
    return async (req, res, next) => {
      try {
        return await action(req, res)
      } catch (error) {
        if (error instanceof BlindBoxError) return failure(res, error.status, error.message)
        return next(error)
      }
    }
  }

  router.get('/blind-box/styles', handle((req, res) => {
    return res.json({ success: true, ...service.styles() })
  }))

  router.post('/blind-box/draw', handle(async (req, res) => {
    const box = await service.draw({
      userId: req.user.id,
      style: req.body?.style,
      count: req.body?.count,
    })
    return res.status(201).json({ success: true, box })
  }))

  router.get('/blind-box/boxes', handle((req, res) => {
    const page = parsePage(req.query)
    if (!page) return failure(res, 400, '分页参数无效')
    return res.json({ success: true, ...service.favorites(req.user.id, page) })
  }))

  router.get('/blind-box/boxes/:id', handle((req, res) => {
    const id = parseId(req.params.id)
    if (!id) return failure(res, 400, '盲盒 ID 无效')
    return res.json({ success: true, box: service.box(req.user.id, id) })
  }))

  router.post('/blind-box/boxes/:id/favorite', handle((req, res) => {
    const id = parseId(req.params.id)
    if (!id) return failure(res, 400, '盲盒 ID 无效')
    return res.json({ success: true, box: service.favorite(req.user.id, id) })
  }))

  router.delete('/blind-box/boxes/:id/favorite', handle((req, res) => {
    const id = parseId(req.params.id)
    if (!id) return failure(res, 400, '盲盒 ID 无效')
    return res.json({ success: true, box: service.unfavorite(req.user.id, id) })
  }))

  router.get('/blind-box/ranking', handle((req, res) => {
    const style = req.query.style === undefined ? 'all' : String(req.query.style)
    const metric = req.query.metric === undefined ? 'favorite' : String(req.query.metric)
    const limit = req.query.limit === undefined ? 8 : Number(req.query.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      return failure(res, 400, '榜单数量无效')
    }
    return res.json({ success: true, ...service.ranking({ metric, style, limit }) })
  }))

  return router
}

module.exports = { createBlindBoxRouter }
