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
      }),
    })
    const loginBody = await safeJson(loginResponse)
    if (!loginResponse.ok) {
      const message = isObject(loginBody) && typeof loginBody.message === 'string'
        ? loginBody.message
        : '登录失败，请检查账号信息后重试'
      throw new AuthFlowError('LOGIN_REJECTED', message, loginResponse.status)
    }

    // 登录成功后只以服务端 Session 的实时身份为准，避免相信陈旧响应。
    const meResponse = await fetcher('/api/auth/me', { credentials: 'same-origin' })
    const meBody = await safeJson(meResponse)
    const user = isObject(meBody) && meBody.authenticated === true && isObject(meBody.user)
      ? meBody.user
      : null
    if (
      !meResponse.ok
      || !user
      || typeof user.id !== 'number'
      || typeof user.email !== 'string'
      || (user.role !== 'admin' && user.role !== 'user')
    ) {
      throw new AuthFlowError('SESSION_UNVERIFIED', '登录会话未能通过服务器确认', meResponse.status)
    }

    return { user: user as unknown as AuthenticatedUser }
  } catch (error) {
    if (error instanceof AuthFlowError) throw error
    throw new AuthFlowError('NETWORK_ERROR', '无法连接服务器，请稍后重试')
  }
}
