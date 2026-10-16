export interface AuthenticatedUser {
  id: number
  email: string
  nickname?: string
  role: 'user' | 'admin'
  mustChangePassword?: boolean
}

export interface LoginCredentials {
  email: string
  password: string
  rememberMe?: boolean
}

type FetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type Fetcher = (
  input: string,
  init?: {
    method?: string
    credentials?: 'same-origin'
    headers?: Record<string, string>
    body?: string
    cache?: 'no-store'
  },
) => Promise<FetchResponse>

export class AuthFlowError extends Error {
  readonly code: 'CSRF_FAILED' | 'LOGIN_REJECTED' | 'SESSION_UNVERIFIED' | 'NETWORK_ERROR'
  readonly status?: number

  constructor(
    code: 'CSRF_FAILED' | 'LOGIN_REJECTED' | 'SESSION_UNVERIFIED' | 'NETWORK_ERROR',
    message: string,
    status?: number,
  ) {
    super(message)
    this.name = 'AuthFlowError'
    this.code = code
    this.status = status
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function safeJson(response: FetchResponse) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function verifiedUser(body: unknown): AuthenticatedUser | null {
  const user = isObject(body) && body.authenticated === true && isObject(body.user)
    ? body.user : null
  if (!user || !Number.isSafeInteger(user.id) || Number(user.id) <= 0
    || typeof user.email !== 'string'
    || (user.role !== 'admin' && user.role !== 'user')) return null
  return user as unknown as AuthenticatedUser
}

// 自动恢复只读取 HttpOnly Session 对应的实时身份，浏览器不保存或重发密码。
export async function restoreSession(
  fetcher: Fetcher = window.fetch.bind(window) as Fetcher,
): Promise<AuthenticatedUser | null> {
  try {
    const response = await fetcher('/api/auth/me', {
      credentials: 'same-origin', cache: 'no-store',
    })
    return response.ok ? verifiedUser(await safeJson(response)) : null
  } catch {
    return null
  }
}

export async function logoutSession(fetcher: Fetcher = window.fetch.bind(window) as Fetcher) {
  try {
    const response = await fetcher('/api/security/csrf-token', { credentials: 'same-origin', cache: 'no-store' })
    const body = await safeJson(response)
    if (!response.ok || !isObject(body) || typeof body.csrfToken !== 'string' || !body.csrfToken) throw new Error('无法验证退出请求')
    const logout = await fetcher('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': body.csrfToken } })
    if (!logout.ok) throw new Error('退出未成功')
  } catch { throw new Error('退出失败，请稍后重试') }
}

export async function loginAndVerify(
  credentials: LoginCredentials,
  fetcher: Fetcher = window.fetch.bind(window) as Fetcher,
) {
  try {
    const csrfResponse = await fetcher('/api/security/csrf-token', {
      credentials: 'same-origin',
    })
    const csrfBody = await safeJson(csrfResponse)
    const csrfToken = isObject(csrfBody) ? csrfBody.csrfToken : null
    if (!csrfResponse.ok || typeof csrfToken !== 'string' || !csrfToken) {
      throw new AuthFlowError('CSRF_FAILED', '无法建立安全登录会话', csrfResponse.status)
    }

    const loginResponse = await fetcher('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        email: credentials.email.trim().toLowerCase(),
        password: credentials.password,
        rememberMe: credentials.rememberMe === true,
      }),
    })
    const loginBody = await safeJson(loginResponse)
    if (!loginResponse.ok) {
      const message = isObject(loginBody) && typeof loginBody.message === 'string'
        ? loginBody.message
        : '登录失败，请检查账号信息后重试'
      throw new AuthFlowError('LOGIN_REJECTED', message, loginResponse.status)
    }
    if (isObject(loginBody) && loginBody.requiresTwoFactor === true) {
      return { user: null, requiresTwoFactor: true as const, enrollmentRequired: loginBody.enrollmentRequired === true }
    }

    // 登录成功后只以服务端 Session 的实时身份为准，避免相信陈旧响应。
    const meResponse = await fetcher('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    const meBody = await safeJson(meResponse)
    const user = verifiedUser(meBody)
    if (!meResponse.ok || !user) {
      throw new AuthFlowError('SESSION_UNVERIFIED', '登录会话未能通过服务器确认', meResponse.status)
    }

    return { user }
  } catch (error) {
    if (error instanceof AuthFlowError) throw error
    throw new AuthFlowError('NETWORK_ERROR', '无法连接服务器，请稍后重试')
  }
}

// 每次提升权限都会轮换 Session，因此修改请求重新获取 CSRF Token。
export async function twoFactorRequest(path: string, body?: Record<string, unknown>, fetcher: Fetcher = window.fetch.bind(window) as Fetcher): Promise<Record<string, unknown>> {
  try {
    let headers: Record<string, string> = {}
    if (body) {
      const csrf = await fetcher('/api/security/csrf-token', { credentials: 'same-origin', cache: 'no-store' })
      const token = await safeJson(csrf)
      if (!csrf.ok || !isObject(token) || typeof token.csrfToken !== 'string') throw new Error('无法验证安全请求')
      headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token.csrfToken }
    }
    const response = await fetcher(`/api/auth/2fa/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await safeJson(response)
    if (!response.ok || !isObject(data)) throw new Error(isObject(data) && typeof data.message === 'string' ? data.message : '两步验证服务暂时不可用')
    return data
  } catch (error) { throw error instanceof Error ? error : new Error('无法连接服务器') }
}

export async function verifyTwoFactor(code: string, recovery = false, fetcher: Fetcher = window.fetch.bind(window) as Fetcher) {
  await twoFactorRequest(recovery ? 'recovery' : 'verify', { code }, fetcher)
  const user = await restoreSession(fetcher)
  if (!user) throw new Error('登录会话未能通过服务器确认')
  return user
}
