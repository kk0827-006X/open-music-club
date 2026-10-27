export interface AccessApplicationInput { email: string; nickname: string; reason?: string }
export type ApplicationPurpose = 'verify' | 'activate'
export type ApplicationFilter = 'pending' | 'awaiting_activation' | 'activated' | 'rejected' | 'notification_error'
export interface AdminApplication {
  id: number; nickname: string; reason: string; status: 'awaiting_verification' | 'pending' | 'approved' | 'rejected'
  emailVerified: boolean; createdAt: string; reviewedAt: string | null; reviewedBy: number | null; activatedAt: string | null
  notificationStatus: 'queued' | 'sending' | 'accepted' | 'delivered' | 'failed' | 'unknown' | 'cancelled' | null
}
interface Options { signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
async function json(response: Response): Promise<unknown> { try { return await response.json() } catch { return null } }

// 固定同源请求和本地错误文案，不回显上游内部错误或凭证。
export async function applicationRequest(path: string, body?: Record<string, unknown>, { signal, timeoutMs = 15000, fetcher = window.fetch.bind(window) }: Options = {}): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const send = async () => {
    let headers: Record<string, string> = {}
    if (body) {
      const csrf = await fetcher('/api/security/csrf-token', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      const token = await json(csrf)
      if (!csrf.ok || !object(token) || typeof token.csrfToken !== 'string' || !token.csrfToken) throw new Error('无法建立安全会话，请稍后重试')
      headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token.csrfToken }
    }
    const response = await fetcher(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await json(response)
    if (!response.ok || !object(data) || data.success !== true) {
      if (response.status === 429) throw new Error('操作过于频繁，请稍后再试')
      if (response.status === 401 || response.status === 403) throw new Error('安全会话或权限验证失败，请重新登录并完成两步验证')
      if (response.status === 409) throw new Error('申请状态已经变化或暂时无法重复申请，请刷新后重试')
      if ([400, 404, 410].includes(response.status)) throw new Error('链接无效、已使用或已过期；请检查输入或重新获取邮件')
      throw new Error('服务暂时不可用，请稍后重试')
    }
    return data
    }
    // 即使测试替身或异常传输未响应 abort，整体超时仍必须释放界面。
    return await Promise.race([send(), new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true })
    })])
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('请求超时，请稍后重试；重复操作不会创建多个账号')
    if (error instanceof TypeError) throw new Error('无法连接服务器，请稍后重试')
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export async function submitAccessApplication(input: AccessApplicationInput, options?: Options) {
  const email = input.email.trim().toLowerCase(), nickname = input.nickname.trim(), reason = input.reason?.trim() || ''
  if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email) || email.length > 254) throw new Error('请输入有效的联系邮箱')
  if (!nickname || nickname.length > 80 || reason.length > 2000) throw new Error('请检查昵称和申请理由长度')
  await applicationRequest('/api/applications', { email, nickname, reason }, options)
}
export const verifyApplicationEmail = (token: string, options?: Options) => applicationRequest('/api/applications/verify-email', { token }, options)
export const resendApplicationMail = (email: string, purpose: ApplicationPurpose, options?: Options) => applicationRequest('/api/applications/resend', { email: email.trim().toLowerCase(), purpose }, options)
export function passwordValid(password: string) { const length = new TextEncoder().encode(password).length; return length >= 15 && length <= 72 }
export const activateApplication = (token: string, password: string, options?: Options) => applicationRequest('/api/auth/activate', { token, password }, options)
export async function listApplications(status: ApplicationFilter, page: number, options?: Options) {
  const data = await applicationRequest(`/api/admin/applications?status=${status}&page=${page}`, undefined, options)
  if (!Array.isArray(data.applications) || !Number.isSafeInteger(data.total)) throw new Error('无法读取申请列表')
  return { applications: data.applications as AdminApplication[], total: Number(data.total), pageSize: 20 }
}
export const reviewApplication = (id: number, decision: 'approve' | 'reject', options?: Options) => applicationRequest(`/api/admin/applications/${id}/${decision}`, {}, options)
