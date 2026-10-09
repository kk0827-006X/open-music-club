import { restoreSession, twoFactorRequest } from './auth-client.ts'
import { uiIcons } from './ui-icons.ts'

export function mountTwoFactorPanel(root: HTMLElement, onComplete?: (role: 'admin' | 'user') => void) {
  let disposed = false, busy = false
  let cleanup = () => undefined as void
  root.innerHTML = `<div class="two-factor-manager"><h3 id="settings-section-title">认证器与恢复码</h3><p data-factor-status role="status">正在查询安全状态…</p><div data-factor-content></div></div>`
  const status = root.querySelector<HTMLElement>('[data-factor-status]')!
  const content = root.querySelector<HTMLElement>('[data-factor-content]')!
  const message = (value: string) => { if (!disposed) status.textContent = value }
  const formMarkup = (action: string, title: string, needsPassword: boolean, needsCode: boolean) => `<form data-factor-action="${action}">
    ${needsPassword ? '<label>当前密码<input type="password" name="password" autocomplete="current-password" required/></label>' : ''}
    ${needsCode ? '<label>认证器验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required/></label>' : ''}
    <button type="submit">${title}${uiIcons.right}</button></form>`
  async function load() {
    try {
      const data = await twoFactorRequest('status')
      if (disposed) return
      if (!data.available) { message('两步验证暂未配置，请联系管理员'); content.innerHTML = ''; return }
      if (data.enabled) {
        message(`已启用两步验证 · 剩余 ${data.recoveryCodesRemaining} 个恢复码。请使用新的验证码，已使用的验证码不可重复。`)
        content.innerHTML = formMarkup('recovery-codes/regenerate', '重新生成恢复码', true, true)
          + (data.canDisable === false ? '<p>管理员不能自行关闭两步验证。</p>' : formMarkup('disable', '关闭两步验证', true, true))
      } else { message('请用认证器扫码绑定；恢复码只会展示一次，请离线保存。'); content.innerHTML = formMarkup('setup', '开始绑定', true, false) }
    } catch (error) { message(error instanceof Error ? error.message : '加载失败') }
  }
  function showCodes(data: Record<string, unknown>) {
    const codes = data.recoveryCodes
    if (!Array.isArray(codes) || !codes.every(code => typeof code === 'string')) throw new Error('未能读取恢复码')
    message('每个恢复码只能使用一次。请离线保存后继续，不要分享给他人。')
    content.innerHTML = '<pre class="two-factor-codes"></pre><button type="button" data-factor-saved>我已保存恢复码</button>'
    content.querySelector('pre')!.textContent = codes.join('\n')
  }
  async function submit(event: Event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null
    if (!form) return
    event.preventDefault()
    if (busy) return
    busy = true
    const fields = new FormData(form), action = form.dataset.factorAction!
    const password = String(fields.get('password') || ''), code = String(fields.get('code') || '')
    form.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true })
    message('正在验证…')
    try {
      const data = await twoFactorRequest(action, { password, code })
      if (disposed) return
      if (action === 'setup') {
        content.innerHTML = '<img class="two-factor-qr" alt="认证器绑定二维码"/><p>无法扫码时，可手动输入下方密钥：</p><code class="two-factor-secret"></code>' + formMarkup('confirm', '确认启用', false, true)
        const image = content.querySelector<HTMLImageElement>('img')!
        if (typeof data.qrCode === 'string' && data.qrCode.startsWith('data:image/png;base64,')) image.src = data.qrCode
        content.querySelector('code')!.textContent = typeof data.secret === 'string' ? data.secret : ''
        message('使用认证器 App 添加 Open Music Club，再输入 6 位验证码。绑定将在 10 分钟后过期。')
      } else if (action === 'disable') await load()
      else showCodes(data)
    } catch (error) { message(error instanceof Error ? error.message : '验证失败') }
    finally {
      busy = false
      form.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = '' })
      if (!disposed) form.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false })
    }
  }
  async function click(event: MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.closest('[data-factor-saved]') || busy) return
    busy = true; content.innerHTML = ''
    try {
      if (onComplete) {
        const user = await restoreSession()
        if (!user) throw new Error('会话未通过确认，请重新登录')
        if (!disposed) onComplete(user.role)
      } else await load()
    } catch (error) { message(error instanceof Error ? error.message : '会话确认失败') }
    finally { busy = false }
  }
  root.addEventListener('submit', submit); root.addEventListener('click', click)
  cleanup = () => { disposed = true; root.removeEventListener('submit', submit); root.removeEventListener('click', click); root.innerHTML = '' }
  void load()
  return cleanup
}
