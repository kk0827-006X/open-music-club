import { useEffect, useRef, useState, type FormEvent } from 'react'
import { passwordRequest } from '../../services/auth/password.ts'
import { activationPasswordError, activationPasswordHint, passwordValid } from '../../services/auth/applications.ts'

// 两个流程共用密码输入及提交生命周期，不共用后端身份凭证或认证状态。
export function PasswordForm({ mode, token, onBusyChange, onComplete }: {
  mode: 'change' | 'reset'; token?: string; onBusyChange?(busy: boolean): void; onComplete?(): void
}) {
  const [busy, setBusy] = useState(false), [complete, setComplete] = useState(false)
  const [recovery, setRecovery] = useState(false), [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  const callbacks = useRef({ onBusyChange, onComplete }); callbacks.current = { onBusyChange, onComplete }
  useEffect(() => () => { request.current?.abort(); callbacks.current.onBusyChange?.(false) }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current || complete) return
    const form = event.currentTarget, fields = new FormData(form), newPassword = String(fields.get('newPassword') || '')
    if (!passwordValid(newPassword)) { setMessage(activationPasswordError); return }
    if (newPassword !== fields.get('confirm')) { setMessage('两次输入的密码不一致'); return }
    const controller = new AbortController(); request.current = controller
    setBusy(true); callbacks.current.onBusyChange?.(true); setMessage('正在更新密码…')
    try {
      await passwordRequest(mode, { newPassword, ...(mode === 'change' ? { oldPassword: fields.get('oldPassword') } : { token }), code: fields.get('code'), recovery }, controller.signal)
      if (!controller.signal.aborted) { form.reset(); setComplete(true); setMessage('密码已更新，所有旧登录已失效。请使用新密码重新登录，两步验证保持原样。'); callbacks.current.onComplete?.() }
    } catch (error) {
      if (!controller.signal.aborted) { form.reset(); setMessage(error instanceof Error ? error.message : '更新失败，请重试') }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); callbacks.current.onBusyChange?.(false) }
    }
  }
  return <div className="two-factor-manager" data-password-panel>
    <h3 id="settings-section-title">{mode === 'change' ? '修改密码' : '设置新密码'}</h3>
    {!complete && <form data-password-form onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        {mode === 'change' && <label>原密码<input type="password" name="oldPassword" autoComplete="current-password" required /></label>}
        <label>新密码<input type="password" name="newPassword" autoComplete="new-password" required minLength={8} /></label>
        <label>确认新密码<input type="password" name="confirm" autoComplete="new-password" required minLength={8} /></label>
        <p>{activationPasswordHint}新密码不能与原密码相同。</p>
        <p>已开启两步验证的账号还需填写验证码或恢复码；未开启可留空。</p>
        <label className="password-recovery-option"><input type="checkbox" checked={recovery} onChange={event => { setRecovery(event.currentTarget.checked); const form = event.currentTarget.form; if (form) (form.elements.namedItem('code') as HTMLInputElement).value = '' }} />使用一次性恢复码</label>
        <label>{recovery ? '恢复码' : '认证器验证码'}<input key={String(recovery)} name="code" inputMode={recovery ? 'text' : 'numeric'} autoComplete={recovery ? 'off' : 'one-time-code'} maxLength={recovery ? 35 : 6} /></label>
      </fieldset>
      <button type="submit" disabled={busy}>{busy ? '正在更新…' : '确认更新密码'}</button>
    </form>}
    <p role="status" aria-live="polite">{message}</p>
  </div>
}
