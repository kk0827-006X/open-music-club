const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function sendSecurityError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
    requestId: res.req.requestId,
  })
}

function requestIdMiddleware(req, res, next) {
  req.requestId = randomUUID()
  res.setHeader('X-Request-Id', req.requestId)
  next()
}

function createHttpsEnforcement(config) {
  return function enforceHttps(req, res, next) {
    if (!config.enforceHttps || req.secure) return next()
    return res.redirect(308, `${config.publicOrigin}${req.originalUrl}`)
  }
}

function createSameOriginCors(config) {
  return function sameOriginCors(req, res, next) {
    const origin = req.get('Origin')
    if (origin && config.publicOrigin && origin !== config.publicOrigin) {
      return sendSecurityError(res, 403, '请求来源不受信任')
    }

    if (origin && origin === config.publicOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.publicOrigin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }

    if (req.method === 'OPTIONS') {
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      )
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,X-CSRF-Token',
      )
      return res.sendStatus(204)
    }
    return next()
  }
}

function tokensMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  )
}

function createCsrfProtection(config) {
  return function csrfProtection(req, res, next) {
    if (!config.csrfEnabled || !UNSAFE_METHODS.has(req.method)) return next()
    const origin = req.get('Origin')
    const suppliedToken = req.get('X-CSRF-Token')
    if (
      origin !== config.publicOrigin ||
      !tokensMatch(req.session?.csrfToken, suppliedToken)
    ) {
      return sendSecurityError(res, 403, 'CSRF 校验失败')
    }
    return next()
  }
}

function csrfTokenHandler(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('base64url')
  }
  req.session.save((error) => {
    if (error) return next(error)
    return res.json({ csrfToken: req.session.csrfToken })
  })
}

function createRateLimiter(options, keyGenerator, store) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    ...(store ? { store } : {}),
    handler(req, res) {
      return sendSecurityError(res, 429, '请求过于频繁，请稍后再试')
    },
  })
}

function createRateLimiters(config, createStore) {
  if (!config.rateLimitEnabled) return null
  const byIp = (req) => ipKeyGenerator(req.ip)
  const loginKey = (req) => {
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : 'unknown'
    return `${ipKeyGenerator(req.ip)}:${email}`
  }

  return {
    global: createRateLimiter(
      config.rateLimits.global,
      byIp,
      createStore?.('global'),
    ),
    login: createRateLimiter(
      config.rateLimits.login,
      loginKey,
      createStore?.('login'),
    ),
    applications: createRateLimiter(
      config.rateLimits.applications,
      byIp,
      createStore?.('applications'),
    ),
    upload: createRateLimiter(
      config.rateLimits.upload,
      byIp,
      createStore?.('upload'),
    ),
    download: createRateLimiter(
      config.rateLimits.download,
      byIp,
      createStore?.('download'),
    ),
    netease: createRateLimiter(
      config.rateLimits.netease,
      byIp,
      createStore?.('netease'),
    ),
  }
}

module.exports = {
  createCsrfProtection,
  createHttpsEnforcement,
  createRateLimiters,
  createSameOriginCors,
  csrfTokenHandler,
  requestIdMiddleware,
  sendSecurityError,
}
