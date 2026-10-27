import { useEffect, useRef, useState, type FormEvent } from 'react'
import { activateApplication, passwordValid, resendApplicationMail, verifyApplicationEmail, type ApplicationPurpose } from '../../services/auth/applications.ts'
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
    if (request.current || complete) return
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password') || '')
    if (activating && (!passwordValid(password) || password !== fields.get('confirm'))) {
      setMessage('密码需为 15～72 个 UTF-8 字节，且两次输入一致。中文通常占 3 字节。'); return
    }
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage('正在安全提交…')
    try {
      if (activating) await activateApplication(token, password, { signal: controller.signal })
      else await verifyApplicationEmail(token, { signal: controller.signal })
      if (!controller.signal.aborted) { setComplete(true); setToken(''); setMessage(activating ? '账号已激活，请使用刚设置的密码登录。' : '邮箱验证成功，申请已进入管理员审核。审核结果将通过邮件通知。') }
    } catch (error) { if (!controller.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试') } }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    const email = String(new FormData(event.currentTarget).get('email') || '')
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      await resendApplicationMail(email, purpose, { signal: controller.signal })
      if (!controller.signal.aborted) setMessage('如果该邮箱符合条件，系统会发送邮件。请查收收件箱及垃圾邮件；每分钟最多重发一次，每天最多五次。')
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '暂时无法处理，请稍后重试') }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  return <main className="application-standalone" data-application-link-page>
    <Brand />
    <section className="application-link-panel" aria-labelledby="link-page-title">
      <p className="application-eyebrow">MEMBER ACCESS / {activating ? 'ACTIVATION' : 'VERIFICATION'}</p>
      <h2 id="link-page-title">{activating ? '设置密码，加入音乐俱乐部' : '确认你的联系邮箱'}</h2>
      <p className="application-description">{activating ? '你的申请已通过审核。设置密码后即可登录；激活链接有效期为 24 小时。' : '点击下方按钮确认邮箱后，申请会进入审核。验证链接有效期为 30 分钟。'}</p>
      {token && !complete && <form onSubmit={event => void submit(event)}>
        {activating && <fieldset disabled={busy}>
          <label className="field-label" htmlFor="activation-password"><span>新密码</span><input id="activation-password" name="password" type="password" autoComplete="new-password" required aria-describedby="password-hint" /></label>
          <label className="field-label" htmlFor="activation-confirm"><span>确认密码</span><input id="activation-confirm" name="confirm" type="password" autoComplete="new-password" required /></label>
          <p id="password-hint" className="application-description">15～72 个 UTF-8 字节，建议使用较长的独特密码。中文通常占 3 字节。</p>
        </fieldset>}
        <button className="primary-action" type="submit" disabled={busy}>{busy ? '正在提交…' : activating ? '设置密码并激活' : '确认邮箱'}</button>
      </form>}
      {!complete && failed && <form className="application-resend-form" onSubmit={event => void resend(event)}>
        <h3>{token ? '需要新的链接？' : '链接缺失或已清除'}</h3>
        <p className="application-description">填写申请邮箱重新获取{activating ? '激活' : '验证'}邮件。已通过审核的申请无需重新审核。</p>
        <label className="field-label" htmlFor="resend-email"><span>申请邮箱</span><input id="resend-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} /></label>
        <button className="application-secondary" disabled={busy} type="submit">重新发送邮件</button>
      </form>}
      <p className="application-feedback" role="status" aria-live="polite">{message}</p>
      <a className="application-return" href="/">{complete && activating ? '返回登录' : '返回音乐俱乐部'}</a>
    </section>
  </main>
}
