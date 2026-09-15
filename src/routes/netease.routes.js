const express = require('express')

const PLAYBACK_LEVELS = new Set([
  'standard',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'vivid',
  'jymaster',
  'sky',
])

function readSingleQueryValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value)
}

function parseIntegerParameter(value, { minimum, maximum }) {
  if (value === undefined) return undefined

  const normalized = readSingleQueryValue(value)
  if (!/^\d+$/.test(normalized)) return null

  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null
  }
  return parsed
}

function parameterError(res, message) {
  return res.status(400).json({ success: false, message })
}

function createNeteaseRouter(neteaseService) {
  const router = express.Router()

  async function callModule(res, moduleName, parameters) {
    try {
      const body = await neteaseService.call(moduleName, parameters)
      return res.status(200).json(body)
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: '网易云服务暂时不可用',
      })
    }
  }

  router.get('/search', (req, res) => {
    const keywords = readSingleQueryValue(req.query.keywords)
    if (!keywords) return parameterError(res, 'keywords 不能为空')

    const limit = parseIntegerParameter(req.query.limit, {
      minimum: 1,
      maximum: 100,
    })
    const offset = parseIntegerParameter(req.query.offset, {
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    })
    if (limit === null || offset === null) {
      return parameterError(res, '分页参数无效')
    }

    return callModule(res, 'search', {
      keywords,
      type: 1,
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    })
  })

  router.get('/song/detail', (req, res) => {
    const ids = readSingleQueryValue(req.query.ids)
    const normalizedIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    if (
      normalizedIds.length === 0 ||
      normalizedIds.some((id) => !isPositiveInteger(id))
    ) {
      return parameterError(res, 'ids 必须是逗号分隔的正整数')
    }

    return callModule(res, 'songDetail', { ids: normalizedIds.join(',') })
  })

  router.get('/song/url/v1', (req, res) => {
    const id = readSingleQueryValue(req.query.id)
    const level = readSingleQueryValue(req.query.level) || 'standard'
    if (!isPositiveInteger(id)) return parameterError(res, 'id 必须是正整数')
    if (!PLAYBACK_LEVELS.has(level)) {
      return parameterError(res, 'level 参数无效')
    }

    return callModule(res, 'songUrlV1', { id, level })
  })

  router.get('/lyric', (req, res) => {
    const id = readSingleQueryValue(req.query.id)
    if (!isPositiveInteger(id)) return parameterError(res, 'id 必须是正整数')

    return callModule(res, 'lyric', { id })
  })

  router.get('/playlist/detail', (req, res) => {
    const id = readSingleQueryValue(req.query.id)
    if (!isPositiveInteger(id)) return parameterError(res, 'id 必须是正整数')

    return callModule(res, 'playlistDetail', { id })
  })

  router.use((req, res) => {
    return res.status(404).json({
      success: false,
      message: '网易云接口不存在',
    })
  })

  return router
}

module.exports = { createNeteaseRouter }
