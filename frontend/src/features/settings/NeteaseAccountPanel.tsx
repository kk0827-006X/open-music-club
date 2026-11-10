import { useEffect, useRef, useState } from 'react';
import {
  neteaseSessionRequest,
  readNeteaseQr,
  readNeteaseStatus,
  type NeteaseQrTicket,
  type NeteaseSessionAction,
  type NeteaseSessionStatus,
} from '../../services/music/netease-session.ts';
export function NeteaseAccountPanel() {
  const [account, setAccount] = useState<NeteaseSessionStatus | null>(null);
  const [qr, setQr] = useState<NeteaseQrTicket | null>(null);
  const [message, setMessage] = useState('正在读取网易云账号状态…');
  const [busy, setBusy] = useState(false);
  const csrf = useRef<string | undefined>(undefined);
  const mounted = useRef(false),
    generation = useRef(0),
    busyRef = useRef(false);
  const requests = useRef(new Set<AbortController>()),
    ticket = useRef<string | null>(null);
  async function run(action: NeteaseSessionAction, body?: Record<string, unknown>) {
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      return await neteaseSessionRequest(action, body, controller.signal, {
        onCsrfToken: (value) => {
          csrf.current = value;
        },
      });
    } finally {
      requests.current.delete(controller);
    }
  }
  const current = (id: number) => mounted.current && generation.current === id;
  async function load(id: number) {
    const data = readNeteaseStatus(await run('status'));
    if (current(id)) setAccount(data);
  }
  useEffect(() => {
    mounted.current = true;
    const id = generation.current;
    void load(id)
      .then(() => {
        if (current(id)) setMessage('');
      })
      .catch((error) => {
        if (current(id)) setMessage(error.message);
      });
    return () => {
      mounted.current = false;
      generation.current++;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      const value = ticket.current,
        token = csrf.current;
      ticket.current = null;
      csrf.current = undefined;
      // 关闭后的取消尽力而为；断网时服务端会在三分钟后丢弃会话，且不会自行轮询。
      if (value && token)
        void neteaseSessionRequest('cancel', { ticket: value }, new AbortController().signal, {
          cancelCsrfToken: token,
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!qr) return;
    const id = generation.current,
      entry = qr;
    let disposed = false,
      timer = 0,
      controller: AbortController | null = null;
    async function poll() {
      if (disposed || !current(id)) return;
      if (Date.now() >= entry.expiresAt) {
        ticket.current = null;
        setQr(null);
        setMessage('二维码已过期，请重新生成');
        return;
      }
      controller = new AbortController();
      requests.current.add(controller);
      try {
        const result = await neteaseSessionRequest(
          'check',
          { ticket: entry.ticket },
          controller.signal,
          {
            onCsrfToken: (value) => {
              csrf.current = value;
            },
          },
        );
        if (disposed || !current(id)) return;
        if (result.state === 'waiting' || result.state === 'confirming') {
          setMessage(
            result.state === 'waiting'
              ? '等待使用网易云音乐 App 扫码'
              : '已扫码，请在网易云音乐 App 中确认',
          );
          timer = window.setTimeout(() => void poll(), 3000);
        } else if (result.state === 'connected' || result.state === 'expired') {
          ticket.current = null;
          setQr(null);
          setMessage(
            result.state === 'connected'
              ? '网易云账号已连接，全站共用此身份'
              : '二维码已过期，请重新生成',
          );
          await load(id);
        } else throw new Error('扫码状态异常，请重新生成二维码');
      } catch (error) {
        if (!disposed && current(id)) {
          ticket.current = null;
          setQr(null);
          setMessage(error instanceof Error ? error.message : '查询失败，请重新生成');
        }
      } finally {
        if (controller) requests.current.delete(controller);
      }
    }
    timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [qr]);
  async function act(action: 'start' | 'logout') {
    if (busyRef.current) return;
    const id = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    ticket.current = null;
    setQr(null);
    setMessage(action === 'start' ? '正在生成二维码…' : '正在退出本站的网易云登录态…');
    try {
      const data = await run(action);
      if (!current(id)) return;
      if (action === 'start') {
        const entry = readNeteaseQr(data);
        ticket.current = entry.ticket;
        setQr(entry);
        setMessage('请使用网易云音乐 App 扫码并确认');
      } else {
        setMessage('已退出本站的网易云登录态');
        await load(id);
      }
    } catch (error) {
      if (current(id)) setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      if (current(id)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="two-factor-manager netease-account-panel" data-netease-account-panel>
      <h3 id="settings-section-title">网易云账号</h3>
      <p>此账号供全站音乐请求共用，仅管理员可更换。网站登录与两步验证保持独立。</p>
      {account && (
        <>
          <p data-netease-connection>
            {account.connected ? '已连接' : '未连接'} ·{' '}
            {account.storage === 'encrypted'
              ? '服务器加密保存，重启可复用'
              : '仅保存在内存，重启后重新扫码'}
          </p>
          {!account.enabled && <p>服务器尚未启用扫码模式，请先完成配置。</p>}
          {account.storageError && (
            <p>保存的登录态无法恢复，请退出后重新扫码，或检查服务器密钥。</p>
          )}
        </>
      )}
      {qr && (
        <img
          className="netease-login-qr"
          src={qr.qrImage}
          alt="使用网易云音乐App扫描此登录二维码"
        />
      )}
      <p role="status" aria-live="polite" data-netease-feedback>
        {message}
      </p>
      <div className="netease-account-actions">
        <button
          type="button"
          data-netease-qr-start
          disabled={busy || !account?.enabled}
          onClick={() => void act('start')}
        >
          {qr ? '重新生成二维码' : account?.connected ? '扫码更换账号' : '扫码登录'}
        </button>
        <button
          type="button"
          data-netease-logout
          disabled={busy || !account?.enabled}
          onClick={() => void act('logout')}
        >
          退出网易云登录态（全站）
        </button>
      </div>
      <p>退出会清除本站保存的登录态，不会退出手机 App。二维码过期或登录态失效后，需要重新扫码。</p>
    </div>
  );
}
