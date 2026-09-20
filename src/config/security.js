const DEFAULT_RATE_LIMITS = Object.freeze({
  global: { windowMs: 15 * 60 * 1000, limit: 300 },
  login: { windowMs: 15 * 60 * 1000, limit: 10 },
  applications: { windowMs: 60 * 60 * 1000, limit: 5 },
  upload: { windowMs: 60 * 60 * 1000, limit: 20 },
  download: { windowMs: 15 * 60 * 1000, limit: 120 },
  netease: { windowMs: 15 * 60 * 1000, limit: 120 },
})

function parsePositiveInteger(value, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`)
  }
  return parsed
}

function parsePublicOrigin(value, production) {
  if (!value) {
    if (production) throw new Error('生产环境必须配置 PUBLIC_ORIGIN')
    return null
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('PUBLIC_ORIGIN 必须是合法 URL')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN 只能包含协议、域名和可选端口')
  }
  if (production && url.protocol !== 'https:') {
    throw new Error('生产环境 PUBLIC_ORIGIN 必须使用 HTTPS')
  }
  return url.origin
}

function mergeRateLimits(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_RATE_LIMITS).map(([name, defaults]) => [
      name,
      { ...defaults, ...(overrides[name] || {}) },
    ]),
  )
}

function createSecurityConfig(options = {}) {
  const production =
    options.production ?? process.env.NODE_ENV === 'production'
  const publicOrigin = parsePublicOrigin(
    options.publicOrigin ?? process.env.PUBLIC_ORIGIN,
    production,
  )
  const trustProxyHops = parsePositiveInteger(
    options.trustProxyHops ?? process.env.TRUST_PROXY_HOPS,
    'TRUST_PROXY_HOPS',
    production ? undefined : 1,
  )

  if (production && !trustProxyHops) {
    throw new Error('生产环境必须配置 TRUST_PROXY_HOPS')
  }

  return {
    production,
    publicOrigin,
    trustProxyHops,
    enforceHttps: options.enforceHttps ?? production,
    csrfEnabled: options.csrfEnabled ?? production,
    rateLimitEnabled: options.rateLimitEnabled ?? production,
    secureCookies: options.secureCookies ?? production,
    cookieName: production
      ? '__Host-open_music_club.sid'
      : 'open_music_club.sid',
    sessionIdleTimeoutMinutes: parsePositiveInteger(
      options.sessionIdleTimeoutMinutes ??
        process.env.SESSION_IDLE_TIMEOUT_MINUTES,
      'SESSION_IDLE_TIMEOUT_MINUTES',
      production ? 480 : undefined,
    ),
    jsonBodyLimit: options.jsonBodyLimit || '1mb',
    logger: options.logger || console,
    rateLimits: mergeRateLimits(options.rateLimits),
  }
}

module.exports = {
  createSecurityConfig,
  parsePositiveInteger,
}
