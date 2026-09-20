const fs = require('node:fs')
const express = require('express')
const { createUploadGuard } = require('../middleware/uploadGuard')
const {
  LocalMusicError,
  createLocalMusicService,
} = require('../services/localMusic.service')

function parseId(value) {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null
}

function createLocalMusicRouter({ database, config, metadataReader }) {
  const router = express.Router()
  const uploadGuard = createUploadGuard(config)
  const service = createLocalMusicService({ database, config, metadataReader })

  function withMusicId(handler) {
    return async (req, res, next) => {
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '音乐 ID 无效' })
      }
      try {
        return await handler(id, req, res, next)
      } catch (error) {
        return next(error)
      }
    }
  }

  router.post('/', uploadGuard, async (req, res, next) => {
    try {
      const track = await service.uploadMusic({
        file: req.file,
        fields: req.body || {},
        uploaderId: req.user.id,
      })
      return res.status(201).json({ success: true, track })
    } catch (error) {
      return next(error)
    }
  })

  router.get('/', (req, res) => {
    return res.json({ success: true, tracks: service.getTracks() })
  })

  router.get(
    '/:id/cover',
    withMusicId((id, req, res, next) => {
      const { music, filePath, stats } = service.getFile(id, 'cover')
      res.set({
        'Content-Type': music.cover_mime_type,
        'Content-Length': stats.size,
        'Cache-Control': 'private, max-age=3600',
      })
      const stream = fs.createReadStream(filePath)
      stream.on('error', next)
      return stream.pipe(res)
    }),
  )

  router.get(
    '/:id/stream',
    withMusicId((id, req, res, next) => {
      const { music, filePath, stats } = service.getFile(id)
      const range = service.parseRange(req.headers.range, stats.size)
      if (range === false) {
        res.set('Content-Range', `bytes */${stats.size}`)
        return res.status(416).end()
      }

      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': music.mime_type,
      }
      let stream
      if (range) {
        const length = range.end - range.start + 1
        Object.assign(headers, {
          'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
          'Content-Length': length,
        })
        res.status(206).set(headers)
        stream = fs.createReadStream(filePath, range)
      } else {
        headers['Content-Length'] = stats.size
        res.status(200).set(headers)
        stream = fs.createReadStream(filePath)
      }
      stream.on('error', next)
      return stream.pipe(res)
    }),
  )

  router.get(
    '/:id/download',
    withMusicId((id, req, res, next) => {
      const { music, filePath } = service.getFile(id)
      let completed = false
      res.once('finish', () => {
        if (completed) return
        completed = true
        try {
          service.registerDownload(id, req.user.id)
        } catch (error) {
          console.error('记录本地音乐下载失败：', error)
        }
      })
      return res.download(filePath, music.original_filename, (error) => {
        if (error) return next(error)
        return undefined
      })
    }),
  )

  router.delete(
    '/:id',
    withMusicId((id, req, res) => {
      service.deleteMusic(id, req.user)
      return res.json({ success: true })
    }),
  )

  router.get(
    '/:id',
    withMusicId((id, req, res) => {
      return res.json({ success: true, track: service.getTrack(id) })
    }),
  )

  router.use((error, req, res, next) => {
    if (error instanceof LocalMusicError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      })
    }
    return next(error)
  })

  return router
}

module.exports = {
  createLocalMusicRouter,
}
