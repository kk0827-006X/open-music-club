const express = require('express')
const { createFootprintService, FootprintError, CARD_EVENT_LIMIT, EVENT_LIMIT } = require('../services/footprint.service')
const { sendSecurityError } = require('../middleware/security')

function parseId(value) {
  if (!['string', 'number'].includes(typeof value)) return null
  const text = String(value)
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? String(Number(text)) : null
}
function parsePage(query, defaultLimit = 20, maxOffset = 10000) {
  if (Object.keys(query).some((key) => !['limit', 'offset'].includes(key))) return null
  const limit = query.limit === undefined ? String(defaultLimit) : query.limit
  const offset = query.offset === undefined ? '0' : query.offset
  if (typeof limit !== 'string' || typeof offset !== 'string' || !/^[1-9]\d*$/.test(limit) || !/^(0|[1-9]\d*)$/.test(offset)) return null
  const page = { limit: Number(limit), offset: Number(offset) }
  return Number.isSafeInteger(page.limit) && page.limit <= 50 && Number.isSafeInteger(page.offset) && page.offset <= maxOffset ? page : null
}
function readText(value, max, min = 1) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  // 控制字符不能进入快照；普通换行和制表符允许用于随笔。
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null
  return text.length >= min && text.length <= max ? text : null
}

function createFootprintRouter({ database, timezoneOffsetMinutes } = {}) {
  const router = express.Router()
  const service = createFootprintService({ database, timezoneOffsetMinutes })
  const fail = (res, status, message) => sendSecurityError(res, status, message)
  const invalid = (res, message) => fail(res, 400, message)
  const idOf = (req) => parseId(req.params.id)
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  router.post('/events', (req, res) => {
    const body = req.body || {}
    const sourceId = parseId(body.sourceId)
    const title = readText(body.title, 200)
    const artist = readText(body.artist ?? '', 200, 0)
    const album = readText(body.album ?? '', 200, 0)
    if (!['local', 'netease'].includes(body.source) || !sourceId || title === null || artist === null || album === null) return invalid(res, '播放记录无效')
    if (!Number.isSafeInteger(body.durationMs) || body.durationMs < 0 || body.durationMs > 86400000) return invalid(res, '播放时长无效')
    if (body.coverUrl != null && (typeof body.coverUrl !== 'string' || body.coverUrl.length > 600)) return invalid(res, '歌曲封面无效')
    const eventId = service.recordPlayback(req.user.id, { source: body.source, sourceId, title, artist, album, durationMs: body.durationMs, coverUrl: body.coverUrl })
    return res.status(201).json({ success: true, eventId })
  })
  router.get('/timeline', (req, res) => {
    const page = parsePage(req.query, 20, EVENT_LIMIT)
    if (!page) return invalid(res, '分页参数无效')
    return res.json({ success: true, ...service.timeline(req.user.id, page.limit, page.offset) })
  })
  router.put('/events/:id/note', (req, res) => {
    const id = idOf(req), content = readText(req.body?.content, 1000)
    if (!id || content === null) return invalid(res, '随笔内容无效')
    service.saveNote(req.user.id, id, content)
    return res.json({ success: true })
  })
  router.delete('/events/:id/note', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '播放记录无效')
    if (!service.deleteNote(req.user.id, id)) return fail(res, 404, '随笔不存在')
    return res.json({ success: true })
  })
  router.get('/milestone', (req, res) => res.json({ success: true, milestone: service.milestone(req.user.id) }))
  router.get('/cards', (req, res) => {
    const page = parsePage(req.query)
    if (!page) return invalid(res, '分页参数无效')
    return res.json({ success: true, ...service.cards(req.user.id, page.limit, page.offset) })
  })
  router.post('/cards', (req, res) => {
    const title = readText(req.body?.title, 60), ids = req.body?.eventIds
    if (title === null || !Array.isArray(ids) || !ids.length || ids.length > CARD_EVENT_LIMIT) return invalid(res, '卡片标题或所选记录无效')
    const eventIds = ids.map(parseId)
    if (eventIds.some((id) => id === null) || new Set(eventIds).size !== eventIds.length) return invalid(res, '所选记录无效')
    return res.status(201).json({ success: true, card: service.createCard(req.user.id, title, eventIds) })
  })
  router.get('/cards/:id', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '卡片 ID 无效')
    const card = service.card(req.user.id, id)
    if (!card) return fail(res, 404, '卡片不存在')
    return res.json({ success: true, card })
  })
  router.delete('/cards/:id', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '卡片 ID 无效')
    if (!service.deleteCard(req.user.id, id)) return fail(res, 404, '卡片不存在')
    return res.json({ success: true })
  })

  router.get('/posts', (req, res) => {
    const page = parsePage(req.query)
    if (!page) return invalid(res, '分页参数无效')
    return res.json({ success: true, ...service.posts(req.user.id, page.limit, page.offset) })
  })
  router.post('/posts', (req, res) => {
    const cardId = parseId(req.body?.cardId), caption = readText(req.body?.caption ?? '', 500, 0)
    if (!cardId || caption === null) return invalid(res, '分享内容无效')
    return res.status(201).json({ success: true, postId: service.publishCard(req.user.id, cardId, caption) })
  })
  router.get('/posts/mine', (req, res) => {
    const page = parsePage(req.query)
    if (!page) return invalid(res, '分页参数无效')
    return res.json({ success: true, posts: service.ownPosts(req.user.id, page.limit, page.offset) })
  })
  router.get('/posts/:id', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '分享 ID 无效')
    const post = service.post(req.user.id, id), card = service.card(post.authorId, post.cardId)
    return res.json({ success: true, timezoneOffsetMinutes: service.timezoneOffsetMinutes, post,
      card: card ? { id: card.id, title: card.title, data: card.data, createdAt: card.createdAt } : null,
      comments: service.comments(id, 50, 0, req.user.id), canDelete: post.authorId === req.user.id })
  })
  router.delete('/posts/:id', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '分享 ID 无效')
    if (!service.deletePost(req.user.id, id)) return fail(res, 404, '分享不存在')
    return res.json({ success: true })
  })
  router.put('/posts/:id/like', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '分享 ID 无效')
    return res.json({ success: true, liked: true, likeCount: service.setLiked(id, req.user.id, true) })
  })
  router.delete('/posts/:id/like', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '分享 ID 无效')
    return res.json({ success: true, liked: false, likeCount: service.setLiked(id, req.user.id, false) })
  })
  router.get('/posts/:id/comments', (req, res) => {
    const id = idOf(req), page = parsePage(req.query, 50)
    if (!id || !page) return invalid(res, '分享 ID 或分页参数无效')
    return res.json({ success: true, comments: service.comments(id, page.limit, page.offset, req.user.id) })
  })
  router.post('/posts/:id/comments', (req, res) => {
    const id = idOf(req), content = readText(req.body?.content, 300)
    if (!id || content === null) return invalid(res, '评论内容无效')
    return res.status(201).json({ success: true, commentId: service.addComment(id, req.user.id, content) })
  })
  router.delete('/comments/:id', (req, res) => {
    const id = idOf(req)
    if (!id) return invalid(res, '评论 ID 无效')
    if (!service.deleteComment(req.user.id, id)) return fail(res, 404, '评论不存在')
    return res.json({ success: true })
  })
  router.use((req, res) => fail(res, 404, '足迹接口不存在'))
  router.use((error, req, res, next) => {
    if (!(error instanceof FootprintError)) return next(error)
    return fail(res, error.status, error.message)
  })
  return router
}

module.exports = { createFootprintRouter }
