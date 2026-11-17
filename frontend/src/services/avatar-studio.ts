import type { AvatarConfig, AvatarOutfit, AvatarSession } from '../shared/avatar.ts';
import { isAvatarSession } from '../shared/avatar.ts';

export class AvatarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
type Fetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
export function createAvatarClient(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  async function request<T>(
    url: string,
    signal: AbortSignal,
    method = 'GET',
    body?: object,
  ): Promise<T> {
    signal.throwIfAborted();
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      const token = await request<{ csrfToken: string }>('/api/security/csrf-token', signal);
      signal.throwIfAborted();
      if (!token.csrfToken) throw new AvatarError('登录已失效，请重新登录', 401);
      headers['X-CSRF-Token'] = token.csrfToken;
      headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      signal.throwIfAborted();
      throw new AvatarError('无法连接服务器，请稍后重试', 0);
    }
    signal.throwIfAborted();
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: '名称或搭配无效，请检查后重试',
        401: '登录已失效，请重新登录',
        403: '安全校验失败，请重新进入工坊',
        404: '形象已不存在，请刷新列表',
        409: '会话已变化或形象数量已达上限，请重新读取形象库',
        429: '操作过于频繁，请稍后重试',
      };
      throw new AvatarError(
        messages[response.status] ?? '工坊暂时不可用，请稍后重试',
        response.status,
      );
    }
    try {
      const result = (await response.json()) as T;
      signal.throwIfAborted();
      return result;
    } catch {
      signal.throwIfAborted();
      throw new AvatarError('服务器响应异常，请稍后重试', 0);
    }
  }
  return {
    read: async (signal: AbortSignal): Promise<AvatarSession> => {
      const data = await request<unknown>('/api/avatar-studio', signal);
      if (!isAvatarSession(data)) throw new AvatarError('服务器响应异常，请稍后重试', 0);
      return data;
    },
    save: (context: string, name: string, config: AvatarConfig, signal: AbortSignal) =>
      request<{ outfit: AvatarOutfit }>('/api/avatar-studio/outfits', signal, 'POST', {
        context,
        name,
        config,
      }),
    rename: (context: string, id: number, name: string, signal: AbortSignal) =>
      request<{ outfit: AvatarOutfit }>(`/api/avatar-studio/outfits/${id}`, signal, 'PATCH', {
        context,
        name,
      }),
    select: (context: string, id: number, signal: AbortSignal) =>
      request<{ outfit: AvatarOutfit }>(
        `/api/avatar-studio/outfits/${id}/current`,
        signal,
        'POST',
        { context },
      ),
    remove: (context: string, id: number, signal: AbortSignal) =>
      request(`/api/avatar-studio/outfits/${id}`, signal, 'DELETE', { context }),
  };
}
