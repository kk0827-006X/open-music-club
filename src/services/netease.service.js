const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const VENDOR_PACKAGE = '@neteasecloudmusicapienhanced/api'

const DEFAULT_MODULES = Object.freeze({
  search: require(`${VENDOR_PACKAGE}/module/search`),
  songDetail: require(`${VENDOR_PACKAGE}/module/song_detail`),
  songUrlV1: require(`${VENDOR_PACKAGE}/module/song_url_v1`),
  lyric: require(`${VENDOR_PACKAGE}/module/lyric`),
  playlistDetail: require(`${VENDOR_PACKAGE}/module/playlist_detail`),
})

function loadVendorRequestClient() {
  return require(`${VENDOR_PACKAGE}/util/request`)
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
} = {}) {
  let resolvedRequestClient = requestClient

  function createInternalCookie() {
    const cookie = {}
    if (runtimeCredentials.anonymousToken) {
      cookie.MUSIC_A = runtimeCredentials.anonymousToken
    }
    if (runtimeCredentials.deviceId) {
      cookie.deviceId = runtimeCredentials.deviceId
    }
    return cookie
  }

  return {
    async call(moduleName, parameters) {
      if (initializationError) {
        throw new Error('网易云运行时不可用')
      }

      const moduleFunction = modules[moduleName]
      if (!moduleFunction) {
        throw new Error('网易云模块未在白名单中')
      }

      if (!resolvedRequestClient) {
        resolvedRequestClient = loadVendorRequestClient()
      }

      const moduleResponse = await moduleFunction(
        { ...parameters, cookie: createInternalCookie() },
        resolvedRequestClient,
      )
      return moduleResponse.body
    },
  }
}

module.exports = {
  DEFAULT_MODULES,
  createNeteaseService,
  initializeNeteaseRuntime,
}
