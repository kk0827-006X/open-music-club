import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal, ModalAction } from '../../shared/react/ui.tsx';
import { passwordRequest } from '../../services/auth/password.ts';
export function ForgotPasswordDialog({ onClose }: { onClose(): void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const email = String(new FormData(event.currentTarget).get('email') || '')
      .trim()
      .toLowerCase();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      await passwordRequest('forgot', { email }, controller.signal);
      if (!controller.signal.aborted)
        setMessage('如果该邮箱对应可用账号，系统会发送重置邮件。链接 15 分钟内有效。');
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '请求失败');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      closeButton={{ label: '关闭密码找回' }}
      className="login-factor-dialog login-application-dialog"
      data-forgot-password-dialog
      aria-labelledby="forgot-title"
    >
      <section className="access-panel">
        <div className="panel-content">
          <h2 id="forgot-title">忘记密码</h2>
          <form data-forgot-password-form onSubmit={(event) => void submit(event)}>
            <label className="field-label">
              注册邮箱
              <input
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                maxLength={254}
                required
                disabled={busy}
              />
            </label>
            <ModalAction type="submit" disabled={busy}>
              {busy ? '发送中…' : '发送重置邮件'}
            </ModalAction>
            <p className="application-feedback" role="status">
              {message}
            </p>
          </form>
        </div>
      </section>
    </Modal>
  );
}
