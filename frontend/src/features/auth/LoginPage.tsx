import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { verifyTwoFactor, type LoginCredentials } from '../../services/auth/session.ts'
import { Brand, Icon, IconButton, Modal } from '../../shared/react/ui.tsx'
import { useReducedMotion } from '../../shared/react/hooks.ts'
import { LoginGlassEffect } from '../../shared/react/LoginGlassEffect.tsx'
import { TwoFactorPanel } from './TwoFactorPanel.tsx'

type Role = 'admin' | 'user'
type AuthenticationResult = { role?: Role; requiresTwoFactor?: boolean; enrollmentRequired?: boolean }

function FactorChallenge({ onVerified, onBusyChange }: {
  onVerified: (role: Role) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const submitting = useRef(false)
  const callbacks = useRef({ onVerified, onBusyChange })
  callbacks.current = { onVerified, onBusyChange }
  useEffect(() => {
    mounted.current = true
    input.current?.focus()
    return () => { mounted.current = false; generation.current++; callbacks.current.onBusyChange(false) }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    const id = ++generation.current
    setBusy(true)
    callbacks.current.onBusyChange(true)
    try {
      const user = await verifyTwoFactor(code.trim(), recovery)
      if (mounted.current && generation.current === id) callbacks.current.onVerified(user.role)
    } catch (error) {
      if (mounted.current && generation.current === id) setFeedback(error instanceof Error ? error.message : '验证失败')
    } finally {
      if (mounted.current && generation.current === id) {
        setCode(''); setCaret(0); setBusy(false)
        submitting.current = false
        callbacks.current.onBusyChange(false)
      }
    }
  }
  const syncCaret = () => setCaret(Math.min(input.current?.selectionStart ?? input.current?.value.length ?? 0, 5))
  return <form className={`factor-challenge${recovery ? ' is-recovery' : ''}`} data-login-factor onSubmit={event => void submit(event)}>
    <p className="factor-challenge-step">STEP 02 / TOTP 2FA CHALLENGE</p>
    <h2 id="authenticator-title">{recovery ? '输入一组未使用的恢复码' : '手机打开验证器 App，输入 6 位动态口令'}</h2>
    <div className="factor-code-field">
      <div className="factor-code-digits" data-factor-digits aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <span key={index} data-factor-digit className={focused && index === caret ? 'is-current' : undefined}>{recovery ? '' : code[index] ?? ''}</span>)}
      </div>
      <input ref={input} className="factor-code-input" name="code" aria-label={recovery ? '恢复码' : '验证码'} inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 35 : 6} spellCheck={false} required
        value={code} onChange={event => { setCode(event.currentTarget.value); syncCaret() }}
        onSelect={syncCaret} onKeyUp={syncCaret} onFocus={() => { setFocused(true); syncCaret() }} onBlur={() => setFocused(false)}
        onClick={event => {
          if (recovery) return
          const bounds = event.currentTarget.getBoundingClientRect()
          const index = bounds.width ? Math.max(0, Math.min(5, Math.floor((event.clientX - bounds.left) / (bounds.width / 6)))) : 0
          const position = Math.min(index, code.length)
          event.currentTarget.setSelectionRange(position, position)
          setCaret(position)
        }} />
    </div>
    <label className="factor-recovery-option"><input type="checkbox" name="recovery" checked={recovery} disabled={busy} onChange={event => { setRecovery(event.currentTarget.checked); setCode(''); setCaret(0) }} />使用恢复码</label>
    <button className="factor-confirm" type="submit" disabled={busy}>确认登录<Icon name="right" /></button>
    <p role="status" data-factor-feedback>{feedback}</p>
  </form>
}

export function LoginPage({ onAuthenticate, onVerified }: {
  onAuthenticate?: (credentials: LoginCredentials) => Promise<AuthenticationResult>
  onVerified?: (role: Role) => void
}) {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [factor, setFactor] = useState<'challenge' | 'enrollment' | null>(null)
  const [factorBusy, setFactorBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [label, setLabel] = useState('验证身份')
  const [status, setStatus] = useState('勾选保持登录后，下次进入将自动确认身份')
  const password = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const factorBusyRef = useRef(false)
  const closingRef = useRef(false)
  const generation = useRef(0)
  const closeTimer = useRef(0)
  const focusPasswordAfterClose = useRef(false)
  const callbacks = useRef({ onAuthenticate, onVerified })
  callbacks.current = { onAuthenticate, onVerified }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++; window.clearTimeout(closeTimer.current) }
  }, [])
  useEffect(() => {
    if (factor === null && focusPasswordAfterClose.current) {
      focusPasswordAfterClose.current = false
      password.current?.focus()
    }
  }, [factor])

  const reportFactorBusy = (value: boolean) => {
    if (!mounted.current) return
    factorBusyRef.current = value
    setFactorBusy(value)
  }
  const verified = (role: Role) => {
    setLabel('认证通过')
    setStatus(role === 'admin' ? '管理员身份已由服务器确认' : '成员身份已由服务器确认')
    callbacks.current.onVerified?.(role)
  }
  const closeFactor = (role?: Role) => {
    if (!mounted.current || !factor || closingRef.current || (factorBusyRef.current && !role)) return
    closingRef.current = true
    setClosing(true)
    const id = generation.current
    closeTimer.current = window.setTimeout(() => {
      if (!mounted.current || id !== generation.current) return
      setFactor(null); setClosing(false); setFactorBusy(false)
      factorBusyRef.current = false; closingRef.current = false
      if (role) verified(role)
      else {
        submitting.current = false; setBusy(false); setLabel('验证身份')
        setStatus('两步验证未完成，请重新输入密码登录')
        // 等原生 dialog 真正关闭后再恢复焦点，避免背景仍处于 inert 状态。
        focusPasswordAfterClose.current = true
      }
    }, reduced ? 0 : 180)
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || factor) return
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email') || '')
    const secret = String(fields.get('password') || '')
    if (!email.trim() || !secret) { setStatus('请输入邮箱和密码'); return }
    if (!callbacks.current.onAuthenticate) { setStatus('登录服务尚未连接'); return }
    submitting.current = true
    setBusy(true); setLabel('正在验证身份'); setStatus('正在建立安全会话…')
    const id = ++generation.current
    try {
      const result = await callbacks.current.onAuthenticate({ email, password: secret, rememberMe: fields.get('rememberMe') === 'on' })
      if (!mounted.current || generation.current !== id) return
      if (password.current) password.current.value = ''
      if (result.requiresTwoFactor) {
        setLabel('等待两步验证')
        setStatus('密码正确，请在弹窗中完成两步验证；过期后请重新登录')
        setFactor(result.enrollmentRequired ? 'enrollment' : 'challenge')
        return
      }
      if (result.role === 'admin' || result.role === 'user') verified(result.role)
      else {
        // 过期或未确认的响应不具备进入应用的权限。
        submitting.current = false; setBusy(false); setLabel('验证身份')
        setStatus('登录会话未能通过服务器确认')
      }
    } catch (error) {
      if (!mounted.current || generation.current !== id) return
      if (password.current) password.current.value = ''
      submitting.current = false; setBusy(false); setLabel('验证身份')
      setStatus(error instanceof Error ? error.message : '登录失败，请稍后重试')
    }
  }
  return <div className="login-shell" data-login-shell style={{ '--panel-progress': 1 } as CSSProperties}>
    <LoginGlassEffect paused={factor !== null} />
    <Brand statistics={false} />
    <div className="brand-lockup login-layout-spacer" aria-hidden="true" inert>
      <p className="brand-name">OPEN MUSIC CLUB</p><p className="brand-subtitle">MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p>
      <p className="brand-note"><span />音乐连接彼此&nbsp;&nbsp;&nbsp;记录此刻与未来</p>
    </div>
    <main className="access-layout">
      <motion.section className="access-stack" aria-labelledby="login-title" data-motion="panel"
        initial={reduced ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : .36, duration: reduced ? 0 : 1.04, ease: 'linear' }}>
        <form className="access-panel" data-login-form noValidate onSubmit={event => void authenticate(event)}>
          <div className="panel-rail"><span className="panel-index">01</span><span>ACCESS</span><span className="panel-mode">MEMBER LOGIN</span><span className="panel-cross" aria-hidden="true">＋</span></div>
          <div className="panel-content">
            <div className="panel-heading"><p className="eyebrow">SECURE MEMBER ENTRY</p><h1 id="login-title">ACCESS / 成员登录</h1><p>登录你的账户，继续探索音乐与故事</p></div>
            <label className="field-label" htmlFor="email"><span>邮箱地址&nbsp;&nbsp;<small>EMAIL</small><b>*</b></span><input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" /></label>
            <label className="field-label" htmlFor="password"><span>密码&nbsp;&nbsp;<small>PASSWORD</small><b>*</b></span><span className="password-field">
              <input ref={password} id="password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="请输入密码" />
              <IconButton icon={visible ? 'eye' : 'eyeOff'} type="button" className={`reveal-password${visible ? ' is-visible' : ''}`} data-reveal-password aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(value => !value)} />
            </span></label>
            <div className="form-options"><label><input type="checkbox" name="rememberMe" data-remember-me /><span>保持登录状态</span></label></div>
            <button className="primary-action" type="submit" disabled={busy}><span data-submit-label>{label}</span><Icon name="right" /></button>
            <p className="form-footnote login-layout-spacer" aria-hidden="true">&nbsp;</p>
            <p className={`preview-notice${busy && !factor && label === '正在验证身份' ? ' is-running' : ''}`} role="status" data-preview-status>{status}</p>
          </div>
        </form>
        <div className="authenticator-panel login-layout-spacer" data-login-factor-spacer aria-hidden="true" inert>
          <div className="panel-rail"><span className="panel-index">02</span><span>AUTHENTICATOR</span><span className="panel-mode">AFTER PASSWORD</span><span className="panel-cross" aria-hidden="true">＋</span></div>
          <div className="authenticator-content"><div><h2>AUTHENTICATOR / 两步验证</h2><p>密码验证通过后，在这里输入认证器生成的验证码</p></div><div className="code-preview" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div><p className="authenticator-state"><span /> WAITING FOR PRIMARY ACCESS</p></div>
        </div>
      </motion.section>
    </main>
    <Modal open={factor !== null} onClose={() => closeFactor()} busy={factorBusy || closing} className={`login-factor-dialog${factor === 'challenge' ? ' is-challenge' : ''}${closing ? ' is-closing' : ''}`} data-login-factor-dialog aria-labelledby={factor === 'enrollment' ? 'settings-section-title' : 'authenticator-title'}>
      <section className="authenticator-panel is-active">
        <div className="panel-rail"><span className="panel-index">02</span><span>AUTHENTICATOR</span><span className="panel-mode">AFTER PASSWORD</span><IconButton icon="close" type="button" data-login-factor-close aria-label="关闭两步验证" disabled={factorBusy || closing} onClick={() => closeFactor()} /></div>
        <div className="authenticator-content" data-login-factor-content>
          {factor === 'enrollment' && <TwoFactorPanel onComplete={closeFactor} onBusyChange={reportFactorBusy} />}
          {factor === 'challenge' && <FactorChallenge onVerified={closeFactor} onBusyChange={reportFactorBusy} />}
        </div>
      </section>
    </Modal>
  </div>
}
