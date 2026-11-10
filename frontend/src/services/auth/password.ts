// 仅访问同源固定接口；错误提示不转发服务端内部响应正文。
export async function passwordRequest(
  action: 'forgot' | 'change' | 'reset',
  body: Record<string, unknown>,
  signal: AbortSignal,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  const safeJson = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      throw new Error('服务响应暂时不可用，请稍后重试');
    }
  };
  const send = async () => {
    const csrf = await fetch('/api/security/csrf-token', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await safeJson(csrf);
    if (!csrf.ok || typeof data?.csrfToken !== 'string')
      throw new Error('安全会话已失效，请重新尝试');
    const response = await fetch(`/api/auth/password/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('尝试过于频繁，请稍后再试');
      if (response.status === 503) throw new Error('密码找回服务暂时不可用，请联系管理员');
      if (response.status === 401) throw new Error('原密码或两步验证未通过；会话失效时请重新登录');
      if (response.status === 403)
        throw new Error('安全会话已失效，请重新尝试；仍失败请重新打开邮件链接');
      if (response.status === 409) throw new Error('安全状态已变化，请重新登录或重新申请链接');
      if (response.status === 400)
        throw new Error(
          action === 'reset'
            ? '密码需符合规则且不能与原密码相同；链接失效时请重新申请'
            : '请检查密码规则、邮箱及输入，新密码不能与原密码相同',
        );
      throw new Error('服务暂时不可用，请稍后重试');
    }
    const result = await safeJson(response);
    if (result?.success !== true) throw new Error('未能确认结果，请重新登录检查');
  };
  try {
    await Promise.race([
      send(),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('请求已取消'));
        else
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('请求超时或已取消，请重新尝试')),
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
