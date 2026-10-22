import { useEffect, useRef, useState, type FormEvent } from 'react'
import { restoreSession, twoFactorRequest } from '../../services/auth/session.ts'
import { Icon } from '../../shared/react/ui.tsx'

type Action = 'setup' | 'confirm' | 'disable' | 'recovery-codes/regenerate'
type FactorView =
  | { kind: 'loading' | 'unavailable' }
  | { kind: 'setup' }
  | { kind: 'enabled'; canDisable: boolean }
  | { kind: 'confirm'; qrCode: string; secret: string }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'saved' }

export function TwoFactorPanel({ onComplete, onBusyChange }: {
  onComplete?: (role: 'admin' | 'user') => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [view, setView] = useState<FactorView>({ kind: 'loading' })
  const [status, setStatus] = useState('正在查询安全状态…')
  const [busy, setBusy] = useState(false)
  const alive = useRef(false)
  const generation = useRef(0)
  const busyRef = useRef(false)
  const callbacks = useRef({ onComplete, onBusyChange })
  callbacks.current = { onComplete, onBusyChange }

  const working = (value: boolean) => {
    busyRef.current = value
    setBusy(value)
    callbacks.current.onBusyChange?.(value)
  }
  const current = (id: number) => alive.current && generation.current === id
  async function load(id: number) {
    const data = await twoFactorRequest('status')
    if (!current(id)) return
    if (!data.available) {
      setStatus('两步验证暂未配置，请联系管理员')
      setView({ kind: 'unavailable' })
    } else if (data.enabled) {
      setStatus(`已启用两步验证 · 剩余 ${data.recoveryCodesRemaining} 个恢复码。请使用新的验证码，已使用的验证码不可重复。`)
      setView({ kind: 'enabled', canDisable: data.canDisable !== false })
    } else {
      setStatus('请用认证器扫码绑定；恢复码只会展示一次，请离线保存。')
      setView({ kind: 'setup' })
    }
  }

  useEffect(() => {
    alive.current = true
    const id = ++generation.current
    working(true)
    void load(id).catch(error => {
      if (current(id)) setStatus(error instanceof Error ? error.message : '加载失败')
    }).finally(() => { if (current(id)) working(false) })
    return () => {
      alive.current = false
      generation.current++
      busyRef.current = false
      callbacks.current.onBusyChange?.(false)
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>, action: Action) {
    event.preventDefault()
    if (busyRef.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const password = String(fields.get('password') || '')
    const code = String(fields.get('code') || '')
    const id = ++generation.current
    working(true)
    setStatus('正在验证…')
    try {
      const data = await twoFactorRequest(action, { password, code })
      if (!current(id)) return
      if (action === 'setup') {
        setView({ kind: 'confirm',
          qrCode: typeof data.qrCode === 'string' && data.qrCode.startsWith('data:image/png;base64,') ? data.qrCode : '',
          secret: typeof data.secret === 'string' ? data.secret : '',
        })
        setStatus('使用认证器 App 添加 Open Music Club，再输入 6 位验证码。绑定将在 10 分钟后过期。')
      } else if (action === 'disable') await load(id)
      else {
        const codes = data.recoveryCodes
        if (!Array.isArray(codes) || !codes.every((code): code is string => typeof code === 'string')) throw new Error('未能读取恢复码')
        setView({ kind: 'codes', codes })
        setStatus('每个恢复码只能使用一次。请离线保存后继续，不要分享给他人。')
      }
    } catch (error) {
      if (current(id)) setStatus(error instanceof Error ? error.message : '验证失败')
    } finally {
      // 机密输入不保留在组件状态、浏览器存储或日志中。
      form.reset()
      if (current(id)) working(false)
    }
  }

  async function saved() {
    if (busyRef.current) return
    const id = ++generation.current
    working(true)
    setView({ kind: 'saved' })
    try {
      if (callbacks.current.onComplete) {
        const user = await restoreSession()
        if (!user) throw new Error('会话未通过确认，请重新登录')
        if (current(id)) callbacks.current.onComplete(user.role)
      } else await load(id)
    } catch (error) {
      if (current(id)) setStatus(error instanceof Error ? error.message : '会话确认失败')
    } finally { if (current(id)) working(false) }
  }

  const actionForm = (action: Action, title: string, needsPassword: boolean, needsCode: boolean) => <form key={action} data-factor-action={action} onSubmit={event => void submit(event, action)}>
    {needsPassword && <label>当前密码<input type="password" name="password" autoComplete="current-password" required /></label>}
    {needsCode && <label>认证器验证码<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>}
    <button type="submit" disabled={busy}>{title}<Icon name="right" /></button>
  </form>

  return <div className="two-factor-manager">
    <h3 id="settings-section-title">认证器与恢复码</h3>
    <p data-factor-status role="status">{status}</p>
    <div data-factor-content>
      {view.kind === 'setup' && actionForm('setup', '开始绑定', true, false)}
      {view.kind === 'enabled' && <>
        {actionForm('recovery-codes/regenerate', '重新生成恢复码', true, true)}
        {view.canDisable ? actionForm('disable', '关闭两步验证', true, true) : <p>管理员不能自行关闭两步验证。</p>}
      </>}
      {view.kind === 'confirm' && <>
        <img className="two-factor-qr" alt="认证器绑定二维码" {...(view.qrCode ? { src: view.qrCode } : {})} />
        <p>无法扫码时，可手动输入下方密钥：</p><code className="two-factor-secret">{view.secret}</code>
        {actionForm('confirm', '确认启用', false, true)}
      </>}
      {view.kind === 'codes' && <pre className="two-factor-codes">{view.codes.join('\n')}</pre>}
      {(view.kind === 'codes' || view.kind === 'saved') && <button type="button" data-factor-saved disabled={busy} onClick={() => void saved()}>我已保存恢复码</button>}
    </div>
  </div>
}
