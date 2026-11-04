import { useEffect, useRef, useState, type FormEvent } from 'react'
import { IconButton, Modal } from '../../shared/react/ui.tsx'
import { passwordRequest } from '../../services/auth/password.ts'
export function ForgotPasswordDialog({ onClose }: { onClose(): void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    const email = String(new FormData(event.currentTarget).get('email') || '').trim().toLowerCase()
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      await passwordRequest('forgot', { email }, controller.signal)
      if (!controller.signal.aborted) setMessage('如果该邮箱对应可用账号，系统会发送重置邮件。请检查收件箱与垃圾邮件，链接15分钟内有效。每分钟最多一次、每天最多五次。')
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '请求失败') }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  return <Modal open onClose={onClose} busy={busy} className="login-factor-dialog login-application-dialog" data-forgot-password-dialog aria-labelledby="forgot-title">
    <section className="access-panel"><div className="panel-rail"><span>ACCOUNT RECOVERY</span><IconButton icon="close" aria-label="关闭密码找回" disabled={busy} onClick={onClose} /></div>
      <div className="panel-content"><h2 id="forgot-title">忘记密码</h2><p>向注册邮箱发送一次性重置链接。已启用两步验证的账号还需认证器验证码或恢复码。</p>
        <form data-forgot-password-form onSubmit={event => void submit(event)}>
          <label className="field-label">注册邮箱<input name="email" type="email" autoComplete="email" autoFocus maxLength={254} required disabled={busy} /></label>
          <button className="primary-action" type="submit" disabled={busy}>发送重置邮件</button>
          <p className="application-feedback" role="status">{message}</p>
        </form>
      </div>
    </section>
  </Modal>
}
