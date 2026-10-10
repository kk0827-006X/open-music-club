import { sampleLoginMotion } from './login-motion.ts'
import type { LoginCredentials } from './auth-client.ts'
import { uiIcons } from './ui-icons.ts'
import { verifyTwoFactor } from './auth-client.ts'
import { mountTwoFactorPanel } from './two-factor-panel.ts'
import { mountLoginGlass } from './login-glass.ts'

export function passwordEyeMarkup(visible: boolean) {
  return visible ? uiIcons.eye : uiIcons.eyeOff
}

export function createLoginMarkup() {
  return `
    <div class="login-shell" data-login-shell>
      <div class="login-glass-effect" data-login-glass aria-hidden="true"></div>
      <header class="archive-brand"><h1>OPEN MUSIC CLUB</h1><p>MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p></header>
      <div class="brand-lockup login-layout-spacer" aria-hidden="true" inert>
        <p class="brand-name">OPEN MUSIC CLUB</p>
        <p class="brand-subtitle">MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p>
        <p class="brand-note"><span></span>音乐连接彼此&nbsp;&nbsp;&nbsp;记录此刻与未来</p>
      </div>

      <main class="access-layout">
        <section class="access-stack" aria-labelledby="login-title" data-motion="panel">
          <form class="access-panel" data-login-form novalidate>
            <div class="panel-rail">
              <span class="panel-index">01</span><span>ACCESS</span>
              <span class="panel-mode">MEMBER LOGIN</span><span class="panel-cross" aria-hidden="true">＋</span>
            </div>
            <div class="panel-content">
              <div class="panel-heading">
                <p class="eyebrow">SECURE MEMBER ENTRY</p>
                <h1 id="login-title">ACCESS / 成员登录</h1>
                <p>登录你的账户，继续探索音乐与故事</p>
              </div>
              <label class="field-label" for="email">
                <span>邮箱地址&nbsp;&nbsp;<small>EMAIL</small><b>*</b></span>
                <input id="email" name="email" type="email" autocomplete="email" placeholder="name@example.com" />
              </label>
              <label class="field-label" for="password">
                <span>密码&nbsp;&nbsp;<small>PASSWORD</small><b>*</b></span>
                <span class="password-field">
                  <input id="password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
                  <button type="button" class="reveal-password" data-reveal-password aria-label="显示密码" aria-pressed="false">${passwordEyeMarkup(false)}</button>
                </span>
              </label>
              <div class="form-options">
                <label><input type="checkbox" name="rememberMe" data-remember-me /> <span>保持登录状态</span></label>
              </div>
              <button class="primary-action" type="submit">
                <span data-submit-label>验证身份</span>${uiIcons.right}
              </button>
              <p class="form-footnote login-layout-spacer" aria-hidden="true">&nbsp;</p>
              <p class="preview-notice" role="status" data-preview-status>勾选保持登录后，下次进入将自动确认身份</p>
            </div>
          </form>

          <div class="authenticator-panel login-layout-spacer" data-login-factor-spacer aria-hidden="true" inert>
            <div class="panel-rail">
              <span class="panel-index">02</span><span>AUTHENTICATOR</span>
              <span class="panel-mode">AFTER PASSWORD</span><span class="panel-cross" aria-hidden="true">＋</span>
            </div>
            <div class="authenticator-content">
              <div><h2>AUTHENTICATOR / 两步验证</h2><p>密码验证通过后，在这里输入认证器生成的验证码</p></div>
              <div class="code-preview" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
              <p class="authenticator-state"><span></span> WAITING FOR PRIMARY ACCESS</p>
            </div>
          </div>
        </section>

      </main>
      <dialog class="login-factor-dialog" data-login-factor-dialog aria-labelledby="authenticator-title">
        <section class="authenticator-panel is-active">
          <div class="panel-rail">
            <span class="panel-index">02</span><span>AUTHENTICATOR</span>
            <span class="panel-mode">AFTER PASSWORD</span>
            <button type="button" data-login-factor-close aria-label="关闭两步验证">${uiIcons.close}</button>
          </div>
          <div class="authenticator-content" data-login-factor-content></div>
        </section>
      </dialog>
    </div>
  `
}

function applyMotion(shell: HTMLElement, elapsedMs: number, reduced: boolean) {
  const frame = sampleLoginMotion(elapsedMs, reduced)
  shell.style.setProperty('--panel-progress', String(frame.panel))
}

export function mountLoginPage(
  root: HTMLElement,
  onAuthenticate?: (credentials: LoginCredentials) => Promise<{ role?: 'admin' | 'user'; requiresTwoFactor?: boolean; enrollmentRequired?: boolean }>,
  onVerified?: (role: 'admin' | 'user') => void,
) {
  root.innerHTML = createLoginMarkup()
  const shell = root.querySelector<HTMLElement>('[data-login-shell]')
  if (!shell) return () => undefined
  const disposeGlass = mountLoginGlass(shell)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const startedAt = performance.now()
  let animationFrame = 0
  let disposed = false
  let factorCleanup = () => undefined as void
  let factorBusy = false, closing = false, closeTimer = 0, factorGeneration = 0
  const dialog = shell.querySelector<HTMLDialogElement>('[data-login-factor-dialog]')!
  const panel = dialog.querySelector<HTMLElement>('[data-login-factor-content]')!
  const closeButton = dialog.querySelector<HTMLButtonElement>('[data-login-factor-close]')!
  const closeFactor = (role?: 'admin' | 'user') => {
    if (disposed || closing || !dialog.open || (factorBusy && !role)) return
    closing = true
    dialog.classList.add('is-closing')
    closeTimer = window.setTimeout(() => {
      if (disposed) return
      factorGeneration++
      factorCleanup(); panel.innerHTML = ''; dialog.close()
      dialog.classList.remove('is-closing'); closing = false; factorBusy = false
      closeButton.disabled = false
      const label = shell.querySelector<HTMLElement>('[data-submit-label]')
      const status = shell.querySelector<HTMLElement>('[data-preview-status]')
      const submit = shell.querySelector<HTMLButtonElement>('.primary-action')
      if (role) {
        if (label) label.textContent = '认证通过'
        if (status) status.textContent = role === 'admin' ? '管理员身份已由服务器确认' : '成员身份已由服务器确认'
        onVerified?.(role)
      } else {
        if (label) label.textContent = '验证身份'
        if (status) status.textContent = '两步验证未完成，请重新输入密码登录'
        submit?.removeAttribute('disabled')
        password?.focus()
      }
    }, reduceMotion ? 0 : 180)
  }
  const cancelFactor = (event: Event) => { event.preventDefault(); closeFactor() }
  const clickFactor = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-login-factor-close]')) { closeFactor(); return }
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeFactor()
    }
  }
  dialog.addEventListener('cancel', cancelFactor)
  dialog.addEventListener('click', clickFactor)
  const animate = (now: number) => {
    const elapsed = now - startedAt
    applyMotion(shell, elapsed, reduceMotion)
    if (!reduceMotion && elapsed < 2400) animationFrame = window.requestAnimationFrame(animate)
  }
  animationFrame = window.requestAnimationFrame(animate)

  const form = shell.querySelector<HTMLFormElement>('[data-login-form]')
  const password = shell.querySelector<HTMLInputElement>('#password')
  const reveal = shell.querySelector<HTMLButtonElement>('[data-reveal-password]')
  const remember = shell.querySelector<HTMLInputElement>('[data-remember-me]')
  if (onAuthenticate) {
    const label = shell.querySelector<HTMLElement>('[data-submit-label]')
    const status = shell.querySelector<HTMLElement>('[data-preview-status]')
    if (label) label.textContent = '验证身份'
    if (status) status.textContent = '勾选保持登录后，下次进入将自动确认身份'
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = shell.querySelector<HTMLInputElement>('#email')
    const submit = shell.querySelector<HTMLButtonElement>('.primary-action')
    const status = shell.querySelector<HTMLElement>('[data-preview-status]')
    const label = shell.querySelector<HTMLElement>('[data-submit-label]')
    if (submit?.disabled || dialog.open) return
    if (!email?.value.trim() || !password?.value) {
      if (status) status.textContent = '请输入邮箱和密码'
      return
    }
    if (!onAuthenticate) {
      if (status) status.textContent = '登录服务尚未连接'
      return
    }
    submit?.setAttribute('disabled', 'true')
    factorCleanup()
    if (label) label.textContent = '正在验证身份'
    if (status) status.textContent = '正在建立安全会话…'
    status?.classList.add('is-running')
    try {
      const result = await onAuthenticate({
        email: email.value, password: password.value, rememberMe: remember?.checked === true,
      })
      if (disposed) return
      password.value = ''
      status?.classList.remove('is-running')
      if (result.requiresTwoFactor) {
        if (label) label.textContent = '等待两步验证'
        if (status) status.textContent = '密码正确，请在弹窗中完成两步验证；过期后请重新登录'
        const generation = ++factorGeneration
        if (result.enrollmentRequired) {
          dialog.setAttribute('aria-labelledby', 'settings-section-title')
          factorCleanup = mountTwoFactorPanel(panel, role => {
            if (!disposed && generation === factorGeneration) closeFactor(role)
          })
        } else {
          dialog.setAttribute('aria-labelledby', 'authenticator-title')
          panel.innerHTML = `<form data-login-factor><h2 id="authenticator-title">AUTHENTICATOR / 两步验证</h2><label>验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required/></label><label><input type="checkbox" name="recovery"/>使用恢复码</label><button type="submit">确认登录${uiIcons.right}</button><p role="status" data-factor-feedback></p></form>`
          const factorForm = panel.querySelector<HTMLFormElement>('form')!, code = factorForm.querySelector<HTMLInputElement>('[name=code]')!, recovery = factorForm.querySelector<HTMLInputElement>('[name=recovery]')!
          recovery.addEventListener('change', () => { code.value = ''; code.maxLength = recovery.checked ? 35 : 6; code.inputMode = recovery.checked ? 'text' : 'numeric' })
          factorForm.addEventListener('submit', async event => {
            event.preventDefault()
            const button = factorForm.querySelector<HTMLButtonElement>('button')!
            if (button.disabled || closing || !dialog.open) return
            button.disabled = true; factorBusy = true; closeButton.disabled = true
            try {
              const user = await verifyTwoFactor(code.value.trim(), recovery.checked)
              if (!disposed && generation === factorGeneration) closeFactor(user.role)
            } catch (error) { if (!disposed && generation === factorGeneration) factorForm.querySelector<HTMLElement>('[data-factor-feedback]')!.textContent = error instanceof Error ? error.message : '验证失败' }
            finally { code.value = ''; if (!closing) { button.disabled = false; factorBusy = false; closeButton.disabled = false } }
          })
        }
        dialog.showModal()
        panel.querySelector<HTMLInputElement>('input:not([type=checkbox])')?.focus()
        return
      }
      if (label) label.textContent = '认证通过'
      if (status) status.textContent = result.role === 'admin'
        ? '管理员身份已由服务器确认'
        : '成员身份已由服务器确认'
    } catch (error) {
      if (disposed) return
      password.value = ''
      status?.classList.remove('is-running')
      if (status) status.textContent = error instanceof Error ? error.message : '登录失败，请稍后重试'
      if (label) label.textContent = '验证身份'
      submit?.removeAttribute('disabled')
    }
  })
  reveal?.addEventListener('click', () => {
    if (!password) return
    const shouldReveal = password.type === 'password'
    password.type = shouldReveal ? 'text' : 'password'
    reveal.innerHTML = passwordEyeMarkup(shouldReveal)
    reveal.setAttribute('aria-label', shouldReveal ? '隐藏密码' : '显示密码')
    reveal.setAttribute('aria-pressed', String(shouldReveal))
    reveal.classList.toggle('is-visible', shouldReveal)
  })
  return () => {
    disposeGlass()
    disposed = true; factorGeneration++; factorCleanup(); panel.innerHTML = ''
    window.clearTimeout(closeTimer); window.cancelAnimationFrame(animationFrame)
    dialog.removeEventListener('cancel', cancelFactor); dialog.removeEventListener('click', clickFactor)
    if (dialog.open) dialog.close()
  }
}
