import { describeArc, sampleLoginMotion } from './login-motion.ts'

export function createLoginMarkup() {
  return `
    <div class="login-shell" data-login-shell>
      <header class="brand-lockup" data-motion="brand">
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
                  <button type="button" class="reveal-password" data-reveal-password aria-label="显示密码">◉</button>
                </span>
              </label>
              <div class="form-options">
                <label><input type="checkbox" /> <span>保持登录状态</span></label>
                <button type="button" class="text-action" data-static-action>忘记密码？</button>
              </div>
              <button class="primary-action" type="submit">
                <span data-submit-label>预览验证动效</span><span aria-hidden="true">→</span>
              </button>
              <p class="form-footnote">没有账户？ <button type="button" class="text-action strong" data-static-action>申请访问&nbsp;→</button></p>
              <p class="preview-notice" role="status" data-preview-status>静态视觉预览 · 当前不会发送登录请求</p>
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

        <section class="protocol-visual" aria-label="认证协议可视化" data-motion="protocol">
          <p><span>AUTHENTICATION PROTOCOL</span></p>
          <svg viewBox="0 0 320 320" role="img" aria-label="安全认证动画">
            <circle class="orbit-guide orbit-guide--outer" cx="160" cy="160" r="120" />
            <circle class="orbit-guide" cx="160" cy="160" r="93" />
            <circle class="orbit-guide" cx="160" cy="160" r="68" />
            <path class="orbit-active" data-orbit-path />
            <g class="orbit-axis"><path d="M160 24V296M24 160H296" /><path d="M154 36H166M154 284H166M36 154V166M284 154V166" /></g>
            <g class="orbit-core">
              <rect x="149" y="151" width="22" height="20" rx="1" /><path d="M153 151V143A7 7 0 0 1 167 143V151" />
              <text x="160" y="192">SECURE</text><text x="160" y="205">ACCESS</text>
            </g>
            <circle class="orbit-node" data-orbit-node cx="160" cy="40" r="5" />
          </svg>
          <p class="protocol-caption">ENCRYPTED SESSION / 01</p>
        </section>

        <aside class="system-status" data-motion="status" aria-labelledby="system-status-title">
          <p id="system-status-title">SYSTEM STATUS&nbsp;&nbsp;/&nbsp;&nbsp;系统状态</p>
          <ol>
            <li class="is-active"><i></i><span><b>连接服务器</b><small>ESTABLISHING CONNECTIVITY</small></span></li>
            <li><i></i><span><b>验证账户信息</b><small>VERIFYING CREDENTIALS</small></span></li>
            <li><i></i><span><b>验证两步验证码</b><small>CHECKING AUTHENTICATOR</small></span></li>
            <li><i></i><span><b>初始化会话</b><small>INITIALIZING SESSION</small></span></li>
          </ol>
          <div class="status-manifesto"><p>A SECURE GATEWAY<br />TO INDEPENDENT MUSIC</p><p>一个属于创作者与听众的音乐档案馆<br />安全连接，探索更多可能</p></div>
        </aside>
      </main>

      <footer class="access-footer">
        <p><span class="lock-mark" aria-hidden="true">▣</span> SECURE SESSION&nbsp;&nbsp;/&nbsp;&nbsp;LOCAL PREVIEW <i></i> 视觉预览</p>
        <p><span></span> WELCOME SEQUENCE READY <b aria-hidden="true">→</b></p>
      </footer>
    </div>
  `
}

function applyMotion(shell: HTMLElement, elapsedMs: number, reduced: boolean) {
  const frame = sampleLoginMotion(elapsedMs, reduced)
  shell.style.setProperty('--brand-progress', String(frame.brand))
  shell.style.setProperty('--panel-progress', String(frame.panel))
  shell.style.setProperty('--protocol-progress', String(frame.protocol))
  shell.style.setProperty('--status-progress', String(frame.status))
  shell.style.setProperty('--orbit-angle', `${frame.orbit}rad`)
  shell.style.setProperty('--pulse', String(frame.pulse))
  shell.querySelector<SVGPathElement>('[data-orbit-path]')?.setAttribute('d', describeArc(160, 160, 93, -90, -90 + frame.protocol * 148))
}

function runStatusPreview(shell: HTMLElement) {
  const items = [...shell.querySelectorAll<HTMLElement>('.system-status li')]
  const status = shell.querySelector<HTMLElement>('[data-preview-status]')
  const label = shell.querySelector<HTMLElement>('[data-submit-label]')
  items.forEach((item) => item.classList.remove('is-active', 'is-complete'))
  status?.classList.add('is-running')
  if (label) label.textContent = '正在预览协议'
  if (status) status.textContent = '演示模式 · 模拟安全认证流程'
  items.forEach((item, index) => {
    window.setTimeout(() => {
      items.forEach((entry, entryIndex) => {
        entry.classList.toggle('is-complete', entryIndex < index)
        entry.classList.toggle('is-active', entryIndex === index)
      })
    }, index * 650)
  })
  window.setTimeout(() => {
    items.forEach((item) => item.classList.remove('is-active', 'is-complete'))
    items[0]?.classList.add('is-active')
    status?.classList.remove('is-running')
    if (label) label.textContent = '预览验证动效'
    if (status) status.textContent = '静态视觉预览 · 当前不会发送登录请求'
  }, items.length * 650 + 650)
}

export function mountLoginPage(
  root: HTMLElement,
  onAuthenticate?: (credentials: { email: string; password: string }) => Promise<{ role: 'admin' | 'user' }>,
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
      const result = await onAuthenticate({ email: email.value, password: password.value })
      password.value = ''
      runStatusPreview(shell)
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
    reveal.setAttribute('aria-label', shouldReveal ? '隐藏密码' : '显示密码')
    reveal.classList.toggle('is-visible', shouldReveal)
  })
  shell.querySelectorAll<HTMLButtonElement>('[data-static-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = shell.querySelector<HTMLElement>('[data-preview-status]')
      if (status) status.textContent = '当前阶段仅实现登录页视觉与动效'
    })
  })
  return () => window.cancelAnimationFrame(animationFrame)
}
