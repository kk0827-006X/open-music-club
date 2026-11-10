const paths = {
  status: '/status',
  start: '/qr',
  check: '/qr/check',
  cancel: '/qr/cancel',
  logout: '/logout',
} as const;
export type NeteaseSessionAction = keyof typeof paths;
export interface NeteaseSessionStatus {
  enabled: boolean;
  mode: 'anonymous' | 'phone' | 'qrcode';
  connected: boolean;
  storage: 'encrypted' | 'memory';
  storageError: boolean;
}
export interface NeteaseQrTicket {
  ticket: string;
  qrImage: string;
  expiresAt: number;
}
export async function neteaseSessionRequest(
  action: NeteaseSessionAction,
  body: Record<string, unknown> | undefined,
  signal: AbortSignal,
  options: { cancelCsrfToken?: string; onCsrfToken?(token: string): void } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 25000);
  const json = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      throw new Error('服务响应暂时不可用，请稍后重试');
    }
  };
  async function send() {
    let headers: Record<string, string> = {};
    if (action !== 'status') {
      let token = action === 'cancel' ? options.cancelCsrfToken : undefined;
      if (!token) {
        const response = await fetch('/api/security/csrf-token', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await json(response);
        if (!response.ok || typeof data?.csrfToken !== 'string')
          throw new Error('安全会话已失效，请重新登录');
        token = data.csrfToken;
        options.onCsrfToken?.(data.csrfToken);
      }
      headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token as string };
    }
    const response = await fetch('/api/admin/netease-session' + paths[action], {
      method: action === 'status' ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers,
      ...(action !== 'status' ? { body: JSON.stringify(body || {}) } : {}),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new Error('需要有效的管理员登录，请重新登录并完成两步验证');
      if (response.status === 409)
        throw new Error('其他管理员正在操作，或二维码已被替换，请重新生成');
      if (response.status === 410) throw new Error('二维码已过期，请重新生成');
      if (response.status === 429) throw new Error('操作过于频繁，请稍后再试');
      if (response.status === 503) throw new Error('服务器尚未启用扫码登录，请检查配置');
      throw new Error('网易云扫码服务暂不可用，请稍后重试或检查服务器配置');
    }
    const data = await json(response);
    if (!data || data.success !== true) throw new Error('无法确认操作结果，请重新查看状态');
    return data;
  }
  try {
    return await Promise.race([
      send(),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('请求已取消'));
        else
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('请求超时或已取消，请重试')),
            { once: true },
          );
      }),
    ]);
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接服务器，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
export function readNeteaseStatus(data: Record<string, unknown>): NeteaseSessionStatus {
  if (
    !['anonymous', 'phone', 'qrcode'].includes(String(data.mode)) ||
    typeof data.connected !== 'boolean' ||
    typeof data.enabled !== 'boolean' ||
    !['encrypted', 'memory'].includes(String(data.storage)) ||
    typeof data.storageError !== 'boolean'
  )
    throw new Error('无法读取网易云账号状态');
  return data as unknown as NeteaseSessionStatus;
}
export function readNeteaseQr(data: Record<string, unknown>): NeteaseQrTicket {
  if (
    typeof data.ticket !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/.test(data.ticket) ||
    typeof data.qrImage !== 'string' ||
    data.qrImage.length > 200000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data.qrImage) ||
    typeof data.expiresAt !== 'number' ||
    !Number.isFinite(data.expiresAt)
  )
    throw new Error('无法读取登录二维码，请重新生成');
  return { ticket: data.ticket, qrImage: data.qrImage, expiresAt: data.expiresAt };
}
