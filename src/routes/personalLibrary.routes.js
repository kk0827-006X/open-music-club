const express = require('express')
const repository = require('../db/personalLibrary')
const { createPersonalLibraryService, SourceLookupError } = require('../services/personalLibrary.service')

function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return null
  return String(Number(text))
}

function parsePage(query) {
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  const offset = query.offset === undefined ? 0 : Number(query.offset)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return null
  return { limit, offset }
}

function readName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length >= 1 && name.length <= 100 ? name : null
}

function readDescription(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 500) return false
  return value.trim() || null
}

function readReference(source, sourceId) {
  const id = parseId(sourceId)
  return ['local', 'netease'].includes(source) && id ? { source, sourceId: id } : null
}

function errorResponse(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function toPlaylist(row) {
  return {
    id: row.id, name: row.name, description: row.description,
    trackCount: row.track_count, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function createPersonalLibraryRouter({ database, neteaseService }) {
  const router = express.Router()
  const service = createPersonalLibraryService({ database, neteaseService })

  function ownedPlaylist(req, res) {
    const id = parseId(req.params.id)
    if (!id) {
      errorResponse(res, 400, '歌单 ID 无效')
      return null
    }
    const playlist = repository.findPlaylist(database, req.user.id, id)
    if (!playlist) {
      errorResponse(res, 404, '歌单不存在')
      return null
    }
    return playlist
  }

  router.get('/playlists', (req, res) => {
    const page = parsePage(req.query)
    if (!page) return errorResponse(res, 400, '分页参数无效')
    const playlists = repository.listPlaylists(database, req.user.id, page.limit, page.offset).map(toPlaylist)
    return res.json({ success: true, playlists })
  })

  router.post('/playlists', (req, res) => {
    const name = readName(req.body?.name)
    const description = readDescription(req.body?.description)
    if (!name || description === false) return errorResponse(res, 400, '歌单信息无效')
    const count = database.prepare('SELECT COUNT(*) AS count FROM user_playlists WHERE owner_user_id = ?').get(req.user.id).count
    if (count >= 100) return errorResponse(res, 409, '歌单数量已达上限')
    const playlist = repository.createPlaylist(database, req.user.id, name, description ?? null)
    return res.status(201).json({ success: true, playlist: toPlaylist(playlist) })
  })

  router.get('/playlists/:id', async (req, res, next) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    try {
      const tracks = await service.hydrate(repository.listPlaylistTracks(database, playlist.id))
      return res.json({ success: true, playlist: toPlaylist(playlist), tracks })
    } catch (error) { return next(error) }
  })

  router.patch('/playlists/:id', (req, res) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    const name = req.body?.name === undefined ? undefined : readName(req.body.name)
    const description = readDescription(req.body?.description)
    if ((name === undefined && description === undefined) || name === null || description === false) {
      return errorResponse(res, 400, '歌单信息无效')
    }
    const updated = repository.updatePlaylist(database, req.user.id, playlist.id, { name, description })
    return res.json({ success: true, playlist: toPlaylist(updated) })
  })

  router.delete('/playlists/:id', (req, res) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    repository.deletePlaylist(database, req.user.id, playlist.id)
    return res.json({ success: true })
  })

  router.post('/playlists/:id/tracks', async (req, res, next) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    const reference = readReference(req.body?.source, req.body?.sourceId)
    if (!reference) return errorResponse(res, 400, '歌曲来源或 ID 无效')
    try {
      if (repository.hasPlaylistTrack(database, playlist.id, reference.source, reference.sourceId)) {
        return errorResponse(res, 409, '歌曲已在歌单中')
      }
      if (!await service.verifyReference(reference.source, reference.sourceId)) {
        return errorResponse(res, 404, '歌曲不存在')
      }
      const entryId = repository.addPlaylistTrack(database, playlist.id, reference.source, reference.sourceId)
      if (entryId === null) return errorResponse(res, 409, '歌曲已在歌单中')
      if (entryId === false) return errorResponse(res, 409, '歌单曲目数量已达上限')
      return res.status(201).json({ success: true, entryId, trackKey: `${reference.source}:${reference.sourceId}` })
    } catch (error) { return next(error) }
  })

  router.delete('/playlists/:id/tracks/:source/:sourceId', (req, res) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    const reference = readReference(req.params.source, req.params.sourceId)
    if (!reference) return errorResponse(res, 400, '歌曲来源或 ID 无效')
    const removed = repository.removePlaylistTrack(database, playlist.id, reference.source, reference.sourceId)
    if (!removed) return errorResponse(res, 404, '歌单中没有这首歌曲')
    return res.json({ success: true })
  })

  router.put('/playlists/:id/tracks/order', (req, res) => {
    const playlist = ownedPlaylist(req, res)
    if (!playlist) return undefined
    const ids = req.body?.trackIds
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      return errorResponse(res, 400, '曲目顺序无效')
    }
    if (!repository.reorderPlaylistTracks(database, playlist.id, ids)) {
      return errorResponse(res, 400, '曲目顺序与歌单不一致')
    }
    return res.json({ success: true })
  })

  router.get('/likes', async (req, res, next) => {
    const page = parsePage(req.query)
    if (!page) return errorResponse(res, 400, '分页参数无效')
    try {
      const tracks = await service.hydrate(repository.listLikes(database, req.user.id, page.limit, page.offset))
      return res.json({ success: true, tracks })
    } catch (error) { return next(error) }
  })

  router.put('/likes/:source/:sourceId', async (req, res, next) => {
    const reference = readReference(req.params.source, req.params.sourceId)
    if (!reference) return errorResponse(res, 400, '歌曲来源或 ID 无效')
    try {
      const alreadyLiked = repository.hasLike(database, req.user.id, reference.source, reference.sourceId)
      if (!alreadyLiked && !await service.verifyReference(reference.source, reference.sourceId)) {
        return errorResponse(res, 404, '歌曲不存在')
      }
      repository.addLike(database, req.user.id, reference.source, reference.sourceId)
      return res.json({ success: true, trackKey: `${reference.source}:${reference.sourceId}` })
    } catch (error) { return next(error) }
  })

  router.delete('/likes/:source/:sourceId', (req, res) => {
    const reference = readReference(req.params.source, req.params.sourceId)
    if (!reference) return errorResponse(res, 400, '歌曲来源或 ID 无效')
    repository.removeLike(database, req.user.id, reference.source, reference.sourceId)
    return res.json({ success: true })
  })

  router.use((error, req, res, next) => {
    if (error instanceof SourceLookupError) return errorResponse(res, 502, '网易云服务暂时不可用')
    return next(error)
  })

  return router
}

module.exports = { createPersonalLibraryRouter }
