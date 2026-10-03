import { sampleLoginMotion } from './login-motion.ts'
import type { LoginCredentials } from './auth-client.ts'
import { uiIcons } from './ui-icons.ts'

export function passwordEyeMarkup(visible: boolean) {
  return visible ? uiIcons.eye : uiIcons.eyeOff
}

export function createLoginMarkup() {
  return `
    <div class="login-shell" data-login-shell>
      <header class="brand-lockup login-layout-spacer" aria-hidden="true" inert>
        <p class="brand-name">OPEN MUSIC CLUB</p>
        <p class="brand-subtitle">MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p>
        <p class="brand-note"><span></span>音乐连接彼此&nbsp;&nbsp;&nbsp;记录此刻与未来</p>
      </header>

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

          <section class="authenticator-panel" aria-labelledby="authenticator-title">
            <div class="panel-rail">
              <span class="panel-index">02</span><span>AUTHENTICATOR</span>
              <span class="panel-mode">AFTER PASSWORD</span><span class="panel-cross" aria-hidden="true">＋</span>
            </div>
            <div class="authenticator-content">
              <div><h2 id="authenticator-title">AUTHENTICATOR / 两步验证</h2><p>密码验证通过后，在这里输入认证器生成的验证码</p></div>
              <div class="code-preview" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
              <p class="authenticator-state"><span></span> WAITING FOR PRIMARY ACCESS</p>
            </div>
          </section>
        </section>

      </main>
    </div>
  `
}

function applyMotion(shell: HTMLElement, elapsedMs: number, reduced: boolean) {
  const frame = sampleLoginMotion(elapsedMs, reduced)
  shell.style.setProperty('--panel-progress', String(frame.panel))
}

export function mountLoginPage(
  root: HTMLElement,
  onAuthenticate?: (credentials: LoginCredentials) => Promise<{ role: 'admin' | 'user' }>,
) {
  root.innerHTML = createLoginMarkup()
  const shell = root.querySelector<HTMLElement>('[data-login-shell]')
  if (!shell) return () => undefined
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const startedAt = performance.now()
  let animationFrame = 0
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
    if (!email?.value.trim() || !password?.value) {
      if (status) status.textContent = '请输入邮箱和密码'
      return
    }
    if (!onAuthenticate) {
      if (status) status.textContent = '登录服务尚未连接'
      return
    }
    submit?.setAttribute('disabled', 'true')
    if (label) label.textContent = '正在验证身份'
    if (status) status.textContent = '正在建立安全会话…'
    status?.classList.add('is-running')
    try {
      const result = await onAuthenticate({
        email: email.value, password: password.value, rememberMe: remember?.checked === true,
      })
      password.value = ''
      status?.classList.remove('is-running')
      if (label) label.textContent = '认证通过'
      if (status) status.textContent = result.role === 'admin'
        ? '管理员身份已由服务器确认'
        : '成员身份已由服务器确认'
    } catch (error) {
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
  return () => window.cancelAnimationFrame(animationFrame)
}
