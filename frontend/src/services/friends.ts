const ROOT = '/api/me/friends';
export const FRIENDS_PAGE_SIZE = 20;
export type FriendsView = 'friends' | 'incoming' | 'outgoing';
export type FriendRow = { id: string; label: string; date: string };
type FriendsPage = { rows: FriendRow[]; hasMore: boolean };

const errorMessages: Record<number, string> = {
  400: '请检查填写的内容',
  401: '登录已失效，请重新登录',
  403: '安全校验失败，请刷新后重试',
  404: '这条记录已变更，请查看最新列表',
  429: '申请过于频繁，请稍后再试',
};

export class FriendsError extends Error {
  constructor(
    readonly status: number,
    message = errorMessages[status] || '服务暂不可用，请重试',
  ) {
    super(message);
  }
}

export function createFriendsClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  async function request(
    url: string,
    signal: AbortSignal,
    method = 'GET',
    body?: { email: string } | { action: 'accept' | 'decline' },
  ): Promise<unknown> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal.aborted) cancel();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 12000);
    async function send(path: string, init?: RequestInit) {
      const response = await fetcher(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        ...init,
      });
      if (!response.ok) throw new FriendsError(response.status);
      return response.status === 204 ? undefined : response.json();
    }
    try {
      const headers: Record<string, string> = {};
      if (method !== 'GET') {
        const csrf = await send('/api/security/csrf-token');
        if (typeof csrf?.csrfToken !== 'string' || !csrf.csrfToken) throw new FriendsError(403);
        headers['X-CSRF-Token'] = csrf.csrfToken;
      }
      if (body) headers['Content-Type'] = 'application/json';
      return await send(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (error) {
      if (error instanceof FriendsError) throw error;
      throw new FriendsError(
        0,
        controller.signal.aborted ? '请求超时，请重试' : '连接失败，请重试',
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
  }

  async function list(view: FriendsView, page: number, signal: AbortSignal): Promise<FriendsPage> {
    const path = view === 'friends' ? ROOT : `${ROOT}/requests/${view}`;
    const query = `limit=${FRIENDS_PAGE_SIZE}&offset=${page * FRIENDS_PAGE_SIZE}`;
    const result = (await request(`${path}?${query}`, signal)) as Partial<{
      success: boolean;
      hasMore: boolean;
      friends: { userId: number; nickname: string; acceptedAt: string }[];
      requests: { id: string; nickname: string; requestedAt: string }[];
      submissions: { id: string; maskedEmail: string; submittedAt: string }[];
    }> | null;
    if (result?.success !== true || typeof result.hasMore !== 'boolean') throw new FriendsError(0);
    let rows: FriendRow[] | undefined;
    if (view === 'friends' && Array.isArray(result.friends))
      rows = result.friends.map(({ userId, nickname, acceptedAt }) => ({
        id: String(userId),
        label: nickname,
        date: acceptedAt,
      }));
    if (view === 'incoming' && Array.isArray(result.requests))
      rows = result.requests.map(({ id, nickname, requestedAt }) => ({
        id,
        label: nickname,
        date: requestedAt,
      }));
    if (view === 'outgoing' && Array.isArray(result.submissions))
      rows = result.submissions.map(({ id, maskedEmail, submittedAt }) => ({
        id,
        label: maskedEmail,
        date: submittedAt,
      }));
    if (!rows) throw new FriendsError(0);
    return { rows, hasMore: result.hasMore };
  }

  async function change(
    url: string,
    signal: AbortSignal,
    method: string,
    body?: { action: 'accept' | 'decline' },
  ) {
    if ((await request(url, signal, method, body)) !== undefined) throw new FriendsError(0);
  }

  return {
    list,
    async submit(email: string, signal: AbortSignal) {
      const result = (await request(`${ROOT}/requests`, signal, 'POST', { email })) as {
        success?: boolean;
      } | null;
      if (result?.success !== true) throw new FriendsError(0);
    },
    reply: (id: string, action: 'accept' | 'decline', signal: AbortSignal) =>
      change(`${ROOT}/requests/incoming/${encodeURIComponent(id)}`, signal, 'PATCH', { action }),
    withdraw: (id: string, signal: AbortSignal) =>
      change(`${ROOT}/requests/outgoing/${encodeURIComponent(id)}`, signal, 'DELETE'),
    remove: (id: string, signal: AbortSignal) =>
      change(`${ROOT}/${encodeURIComponent(id)}`, signal, 'DELETE'),
  };
}
