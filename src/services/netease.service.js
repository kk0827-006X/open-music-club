const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const VENDOR_PACKAGE = '@neteasecloudmusicapienhanced/api'

const DEFAULT_MODULES = Object.freeze({
  search: require(`${VENDOR_PACKAGE}/module/cloudsearch`),
  songDetail: require(`${VENDOR_PACKAGE}/module/song_detail`),
  songUrlV1: require(`${VENDOR_PACKAGE}/module/song_url_v1`),
  lyric: require(`${VENDOR_PACKAGE}/module/lyric`),
  playlistDetail: require(`${VENDOR_PACKAGE}/module/playlist_detail`),
  artistSongs: require(`${VENDOR_PACKAGE}/module/artist_songs`),
  album: require(`${VENDOR_PACKAGE}/module/album`),
})

function loadVendorRequestClient() {
  return require('./netease-request').createNeteaseRequestClient()
}

function getRuntimeConfigurationState(tempDirectory) {
  let anonymousToken = ''
  let deviceId = ''
  let hasPublicKey = false

  try {
    anonymousToken = fs
      .readFileSync(path.join(tempDirectory, 'anonymous_token'), 'utf8')
      .trim()
  } catch (error) {
    anonymousToken = ''
  }

  try {
    const publicKey = JSON.parse(
      fs.readFileSync(path.join(tempDirectory, 'xeapi_public_key'), 'utf8'),
    )
    hasPublicKey =
      typeof publicKey.sk === 'string' && Boolean(publicKey.sk.trim())
    deviceId =
      typeof publicKey.deviceId === 'string' ? publicKey.deviceId.trim() : ''
  } catch (error) {
    hasPublicKey = false
    deviceId = ''
  }

  return {
    anonymousToken,
    deviceId,
    hasAnonymousToken: Boolean(anonymousToken),
    hasPublicKey,
  }
}

function toRuntimeCredentials(state) {
  return {
    anonymousToken: state.anonymousToken,
    deviceId: state.deviceId,
  }
}

async function initializeNeteaseRuntime({
  generateConfig,
  tempDirectory = os.tmpdir(),
  logger = console,
} = {}) {
  const runGenerateConfig =
    generateConfig || require(`${VENDOR_PACKAGE}/generateConfig`)

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await runGenerateConfig()
    } catch (error) {
      if (attempt === 2) break
    }

    const state = getRuntimeConfigurationState(tempDirectory)
    if (state.hasAnonymousToken && state.hasPublicKey) {
      return toRuntimeCredentials(state)
    }
  }

  const state = getRuntimeConfigurationState(tempDirectory)
  if (!state.hasPublicKey) {
    throw new Error('网易云运行时初始化失败')
  }

  if (!state.hasAnonymousToken) {
    logger.warn(
      '网易云匿名 token 为空，将继续启动；匿名接口可用性需通过可选冒烟测试确认',
    )
  }

  return toRuntimeCredentials(state)
}

function createNeteaseService({
  initializationError,
  modules = DEFAULT_MODULES,
  requestClient,
  runtimeCredentials = {},
  auth = { mode: 'anonymous' },
  qrModules = { key: require(`${VENDOR_PACKAGE}/module/login_qr_key`), check: require(`${VENDOR_PACKAGE}/module/login_qr_check`) },
  loginModule = require(`${VENDOR_PACKAGE}/module/login_cellphone`),
} = {}) {
  let resolvedRequestClient = requestClient
  let loginPromise, closed = false, accountUnavailable = false
  let accountCookie = {}, accountEpoch = 0
  const qrMode = auth.mode === 'qrcode'
  const accountMode = auth.mode === 'phone' || qrMode
  let sessionStore, restored = false, storageError = false
  const unavailable = () => new Error('网易云账号暂不可用，请检查配置或上游验证要求')

  function createInternalCookie() {
    const cookie = {}
    if (!accountMode && runtimeCredentials.anonymousToken) {
      cookie.MUSIC_A = runtimeCredentials.anonymousToken
    }
    if (runtimeCredentials.deviceId) {
      cookie.deviceId = runtimeCredentials.deviceId
    }
    return { ...cookie, ...accountCookie }
  }

  function client() {
    if (closed) throw unavailable()
    if (!resolvedRequestClient) resolvedRequestClient = loadVendorRequestClient()
    return resolvedRequestClient
  }
  function readCookies(values) {
    const cookie = {}
    if (!Array.isArray(values)) return cookie
    for (const header of values) {
      if (typeof header !== 'string' || /[\r\n\0]/.test(header)) continue
      const pair = header.split(';', 1)[0], separator = pair.indexOf('=')
      const name = pair.slice(0, separator), value = pair.slice(separator + 1)
      if (separator > 0 && /^[A-Za-z0-9_]+$/.test(name)) {
        const age = /;\s*max-age=(-?\d+)/i.exec(header)
        const expires = /;\s*expires=([^;]+)/i.exec(header)
        const expired = age ? Number(age[1]) <= 0 : expires && Date.parse(expires[1]) <= Date.now()
        cookie[name] = expired ? '' : value
      }
    }
    return cookie
  }
  // 登录只允许服务器内部调用；不增加公开手机号/密码接口。失败结果也只缓存一次，避免触发反复登录。
  function initialize() {
    if (closed || initializationError) return Promise.reject(unavailable())
    if (qrMode) {
      if (!restored && sessionStore) {
        restored = true
        try {
          const cookie = sessionStore.load()
          if (cookie) {
            if (!validAccountCookie(cookie)) throw unavailable()
            accountCookie = { ...cookie }; accountEpoch++
          }
        } catch { accountCookie = {}; storageError = true }
      }
      accountUnavailable = !accountCookie.MUSIC_U
      return Promise.resolve()
    }
    if (!accountMode) return Promise.resolve()
    if (!loginPromise) loginPromise = (async () => {
      try {
        const response = await loginModule({ phone: auth.phone, password: auth.password, countrycode: auth.countrycode, cookie: createInternalCookie() }, client())
        const cookie = readCookies(response?.cookie)
        if (closed || response?.body?.code !== 200 || !cookie.MUSIC_U) throw unavailable()
        accountCookie = cookie; accountEpoch++
      } catch { accountUnavailable = true; throw unavailable() }
    })()
    return loginPromise
  }
  function validAccountCookie(cookie) {
    return cookie && typeof cookie === 'object' && !Array.isArray(cookie) && typeof cookie.MUSIC_U === 'string' && cookie.MUSIC_U.length > 0
      && Object.entries(cookie).every(([name, value]) => /^[A-Za-z0-9_]+$/.test(name) && typeof value === 'string' && !/[;\r\n\0]/.test(value))
  }
  function invalidateAccount() {
    accountUnavailable = true; accountCookie = {}; accountEpoch++
    if (qrMode && sessionStore) { try { sessionStore.clear() } catch { storageError = true } }
  }
  function publicBody(value) {
    if (Array.isArray(value)) return value.map(publicBody)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:cookie|cookies|set-cookie|music_u|music_a|__csrf|password|md5_password)$/i.test(key)).map(([key, item]) => [key, publicBody(item)]))
  }

  return {
    initialize,
    configureQrStore(store) { if (!qrMode || sessionStore) return; sessionStore = store },
    accountStatus() { return { mode: auth.mode, connected: !accountUnavailable && Boolean(accountCookie.MUSIC_U), storage: qrMode ? auth.storage : 'memory', storageError } },
    async requestQr(kind, key) {
      if (!qrMode || closed || initializationError || !qrModules[kind]) throw unavailable()
      try { return await qrModules[kind]({ ...(key ? { key } : {}), cookie: { deviceId: runtimeCredentials.deviceId || '' } }, client()) }
      catch { throw unavailable() }
    },
    acceptQrCookies(headers) {
      if (!qrMode || closed || !sessionStore) throw unavailable()
      const cookie = readCookies(headers)
      if (!validAccountCookie(cookie)) throw unavailable()
      sessionStore.save(cookie)
      accountCookie = cookie; accountEpoch++; accountUnavailable = false; restored = true; storageError = false
    },
    logoutQr() {
      if (!qrMode) throw unavailable()
      accountCookie = {}; accountEpoch++; accountUnavailable = true; restored = true
      try { sessionStore?.clear(); storageError = false } catch { storageError = true; throw unavailable() }
    },
    async close() { closed = true; accountCookie = {}; accountEpoch++; await resolvedRequestClient?.close?.() },
    async call(moduleName, parameters) {
      if (closed) throw unavailable()
      if (initializationError) {
        throw new Error('网易云运行时不可用')
      }

      const moduleFunction = modules[moduleName]
      if (!moduleFunction) {
        throw new Error('网易云模块未在白名单中')
      }

      await initialize()
      if (closed || accountUnavailable) throw unavailable()
      const epoch = accountEpoch
      let moduleResponse
      try {
        moduleResponse = await moduleFunction({ ...parameters, cookie: createInternalCookie() }, client())
      } catch (error) {
        if (accountMode && epoch === accountEpoch && [301, 405, 460, -462].includes(error?.code)) invalidateAccount()
        throw new Error('网易云请求暂时不可用')
      }
      if (closed || epoch !== accountEpoch) throw unavailable()
      if (accountMode && moduleResponse?.body?.code !== 200) {
        if ([301, 405, 460, -462].includes(moduleResponse?.body?.code)) invalidateAccount()
        throw unavailable()
      }
      return publicBody(moduleResponse.body)
    },
  }
}

module.exports = {
  DEFAULT_MODULES,
  createNeteaseService,
  initializeNeteaseRuntime,
}
