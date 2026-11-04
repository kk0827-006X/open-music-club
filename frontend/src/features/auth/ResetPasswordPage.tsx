import { useEffect, useState } from 'react'
import { Brand } from '../../shared/react/ui.tsx'
import { PasswordForm } from './PasswordForm.tsx'
function captureToken() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  window.history.replaceState(window.history.state, '', window.location.pathname)
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
}
export function ResetPasswordPage() {
  const [token, setToken] = useState(captureToken)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    // 在同一标签再次打开邮件可能只有 fragment 导航，也要清除凭证并重建表单。
    const capture = () => {
      if (window.location.pathname !== '/reset-password' || !window.location.hash) return
      setToken(captureToken()); setRevision(value => value + 1)
    }
    window.addEventListener('hashchange', capture); window.addEventListener('popstate', capture)
    return () => { window.removeEventListener('hashchange', capture); window.removeEventListener('popstate', capture) }
  }, [])
  return <main className="application-standalone" data-reset-password-page><Brand />
    <section className="application-link-panel">
      {token ? <PasswordForm key={revision} mode="reset" token={token} /> : <><h2>重置链接缺失或已清除</h2><p>请重新打开邮件中的链接，或返回登录页重新申请。链接只能使用一次，15分钟内有效。</p></>}
      <a className="application-return" href="/login">返回登录</a>
    </section>
  </main>
}
