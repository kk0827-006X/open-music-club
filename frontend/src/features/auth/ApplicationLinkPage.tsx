import { useEffect, useRef, useState, type FormEvent } from 'react'
import { activateApplication, activationPasswordError, activationPasswordHint, passwordValid, resendApplicationMail, type ApplicationPurpose } from '../../services/auth/applications.ts'
import { Brand } from '../../shared/react/ui.tsx'

export function ApplicationLinkPage({ purpose, initialToken }: { purpose: ApplicationPurpose; initialToken: string }) {
  const [token, setToken] = useState(initialToken)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [failed, setFailed] = useState(!initialToken)
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort() }, [])
  const activating = purpose === 'activate'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activating || request.current || complete) return
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password') || '')
    // 规则提示与确认密码分开校验；JS 与后端都会独立检查，不以 HTML 原生校验代替。
    if (!passwordValid(password)) { setMessage(activationPasswordError); return }
    if (password !== fields.get('confirm')) { setMessage('两次输入的密码不一致，请重新输入。'); return }
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('正在安全提交…')
    try {
      await activateApplication(token, password, { signal: controller.signal })
      if (!controller.signal.aborted) { setComplete(true); setToken(''); setMessage('账号已激活，请使用刚设置的密码登录。') }
    } catch (error) { if (!controller.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试') } }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activating || request.current) return
    const email = String(new FormData(event.currentTarget).get('email') || '')
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      await resendApplicationMail(email, 'activate', { signal: controller.signal })
      if (!controller.signal.aborted) setMessage('如果该邮箱对应的申请已通过且尚未激活，系统会发送新的激活邮件。请查收收件箱及垃圾邮件；每分钟最多重发一次，每天最多五次。')
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '暂时无法处理，请稍后重试') }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }

  // 兼容旧邮件中的 /verify-email 链接：只解释流程已简化，不提交验证、不引导重发验证邮件。
  if (!activating) return <main className="application-standalone" data-application-link-page>
    <Brand />
    <section className="application-link-panel" aria-labelledby="link-page-title">
      <p className="application-eyebrow">MEMBER ACCESS / NOTICE</p>
      <h2 id="link-page-title">申请流程已简化</h2>
      <p className="application-description">已提交的申请无需验证邮箱，请等待管理员审核；审核结果会通过邮件通知。通过审核后，激活邮件中的链接可用于设置密码。</p>
      <p className="application-description">如果申请已通过但未收到激活邮件，可前往激活页面重新发送；未通过审核的申请不会发送激活邮件。</p>
      <a className="application-return" href="/activate">前往激活页面</a>
      <a className="application-return" href="/">返回音乐俱乐部</a>
    </section>
  </main>

  return <main className="application-standalone" data-application-link-page>
    <Brand />
    <section className="application-link-panel" aria-labelledby="link-page-title">
      <p className="application-eyebrow">MEMBER ACCESS / ACTIVATION</p>
      <h2 id="link-page-title">设置密码，加入音乐俱乐部</h2>
      <p className="application-description">你的申请已通过审核。设置密码后即可登录；激活链接有效期为 24 小时，且只能使用一次。</p>
      {token && !complete && <form noValidate onSubmit={event => void submit(event)}>
        <fieldset disabled={busy}>
          <label className="field-label" htmlFor="activation-password"><span>新密码</span><input id="activation-password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby="password-hint" /></label>
          <label className="field-label" htmlFor="activation-confirm"><span>确认密码</span><input id="activation-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} /></label>
          <p id="password-hint" className="application-description">{activationPasswordHint}</p>
        </fieldset>
        <button className="primary-action" type="submit" disabled={busy}><span>{busy ? '正在提交…' : '设置密码并激活'}</span></button>
      </form>}
      {!complete && failed && <form className="application-resend-form" onSubmit={event => void resend(event)}>
        <h3>{token ? '需要新的激活链接？' : '链接缺失或已清除'}</h3>
        <p className="application-description">仅已通过审核且尚未激活的申请可以重发激活邮件。每邮箱每分钟一次、每天最多五次；未审核或已激活的申请不会发送。</p>
        <label className="field-label" htmlFor="resend-email"><span>申请邮箱</span><input id="resend-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} /></label>
        <button className="application-secondary" disabled={busy} type="submit">重新发送激活邮件</button>
      </form>}
      <p className="application-feedback" role="status" aria-live="polite">{message}</p>
      <a className="application-return" href="/">{complete ? '返回登录' : '返回音乐俱乐部'}</a>
    </section>
  </main>
}
