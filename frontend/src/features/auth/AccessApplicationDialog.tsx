import { useEffect, useRef, useState, type FormEvent } from 'react'
import { submitAccessApplication } from '../../services/auth/applications.ts'
import { Icon, IconButton, Modal } from '../../shared/react/ui.tsx'

export function AccessApplicationDialog({ onClose }: { onClose(): void }) {
  const email = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    mounted.current = true
    email.current?.focus()
    return () => { mounted.current = false; request.current?.abort() }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || submitted) return
    const fields = new FormData(event.currentTarget)
    const controller = new AbortController()
    request.current = controller
    submitting.current = true
    setBusy(true); setFeedback('正在提交申请…')
    try {
      await submitAccessApplication({
        email: String(fields.get('email') || ''),
        nickname: String(fields.get('nickname') || ''),
        reason: String(fields.get('reason') || ''),
      }, { signal: controller.signal })
      if (!mounted.current || controller.signal.aborted) return
      setSubmitted(true)
      setFeedback('申请已提交并进入审核，无需验证邮箱。审核结果将通过邮件通知；通过后请打开激活邮件，点击链接设置密码。')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setFeedback(error instanceof Error ? error.message : '申请暂时无法提交，请稍后再试')
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        submitting.current = false
        request.current = null
        setBusy(false)
      }
    }
  }

  return <Modal open onClose={onClose} busy={busy} className="login-factor-dialog login-application-dialog" data-application-dialog aria-labelledby="application-title">
    <section className="access-panel">
      <div className="panel-rail"><span className="panel-index">＋</span><span>MEMBER ACCESS</span><span className="panel-mode">APPLICATION</span><IconButton icon="close" data-application-close aria-label="关闭账号申请" disabled={busy} onClick={onClose} /></div>
      <div className="panel-content">
        <div className="panel-heading application-heading"><h2 id="application-title">申请账号</h2><p>提交后直接进入管理员审核，审核结果通过邮件通知。</p></div>
        <form data-application-form onSubmit={event => void submit(event)}>
          <fieldset disabled={busy || submitted}>
            <label className="field-label" htmlFor="application-email"><span>联系邮箱</span><input ref={email} id="application-email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="name@example.com" /></label>
            <label className="field-label" htmlFor="application-nickname"><span>昵称</span><input id="application-nickname" name="nickname" autoComplete="nickname" maxLength={80} required placeholder="希望如何称呼你" /></label>
            <label className="field-label" htmlFor="application-reason"><span>申请理由（选填）</span><textarea id="application-reason" name="reason" rows={3} maxLength={2000} placeholder="简单介绍你与音乐的故事" /></label>
          </fieldset>
          <p className="application-note">昵称和理由会展示给管理员，请勿填写邮箱、电话、密码、验证码或其他敏感信息。此处不是找回密码入口。</p>
          <button className="primary-action" type="submit" data-application-submit disabled={busy || submitted}><span>{submitted ? '申请已提交' : busy ? '正在提交申请' : '提交申请'}</span><Icon name="right" /></button>
          {submitted && <a className="application-resend-link" href="/activate" data-application-activation-link>已通过审核但未收到激活邮件？前往重发</a>}
          <p className="application-feedback" data-application-feedback role="status" aria-live="polite">{feedback}</p>
        </form>
      </div>
    </section>
  </Modal>
}
