const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

function installLoginStyles(document) {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = fs.readFileSync(path.resolve(__dirname, '../frontend/src/styles/login.css'), 'utf8')
  document.head.append(stylesheet)
}

it('React 玻璃层在减少动态效果时保持静态，不更换背景、不遮挡输入及 Logo', async () => {
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    installLoginStyles(h.document)
    await h.render(h.React.createElement(LoginPage))
    const shell = h.require('[data-login-shell]')
    shell.style.backgroundColor = 'rgb(231, 229, 223)'
    const effect = h.require('[data-login-glass]')
    assert.equal(effect.getAttribute('aria-hidden'), 'true')
    assert.equal(h.window.getComputedStyle(effect).pointerEvents, 'none')
    assert.equal(effect.querySelectorAll('button, input, a, [tabindex], canvas, .login-glass-wave').length, 0)
    assert.equal(h.query('[data-login-glass] .archive-brand'), null, 'Logo 不是玻璃遮罩的内部替代品')
    assert.equal(h.document.querySelectorAll('.archive-brand').length, 1)
    await h.input('[name="password"]', 'synthetic-private-input')
    await h.click('[data-reveal-password]')
    assert.equal(h.require('[name="password"]').value, 'synthetic-private-input')
    assert.equal(h.require('[name="password"]').type, 'text')
    assert.equal(h.window.getComputedStyle(shell).backgroundColor, 'rgb(231, 229, 223)')
    assert.equal(h.query('.login-library-glass'), null, '减少动态效果时不加载折射组件')
  })
})

it('真实玻璃组件在输入、2FA 暂停与后台标签期间停止，并保持密码和 Logo 原位', async () => {
  await withReactHarness(async h => {
    const media = { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    h.window.matchMedia = () => media
    const { LoginGlassEffect } = await import('../frontend/src/shared/react/LoginGlassEffect.tsx')
    const createShell = paused => h.React.createElement('section', { className: 'login-shell' },
      h.React.createElement('header', { className: 'archive-brand' }, 'OPEN MUSIC CLUB'),
      h.React.createElement('form', null, h.React.createElement('input', { type: 'password', name: 'password', autoFocus: true, defaultValue: 'synthetic-private-input' })),
      h.React.createElement(LoginGlassEffect, { paused }))
    await h.render(createShell(false))
    const input = h.require('[name="password"]')
    const logo = h.require('.archive-brand')
    assert.equal(h.document.activeElement, input)
    assert.equal(h.query('.login-glass-wave'), null, '开始输入时不挂载折射动效')
    await h.React.act(async () => input.blur())
    await h.until(() => h.query('.login-library-glass'), '退出输入后应挂载实际 liquid-glass-react 组件')
    // 设置测试标记，确保暂停时真实动画清理函数会恢复 Logo 样式，而不依赖帧率。
    logo.style.setProperty('--login-logo-wave-y', '2px')
    logo.style.setProperty('--login-logo-wave-tilt', '.1deg')
    await h.React.act(async () => input.focus())
    assert.equal(h.query('.login-glass-wave'), null)
    assert.equal(logo.style.getPropertyValue('--login-logo-wave-y'), '')
    assert.equal(logo.style.getPropertyValue('--login-logo-wave-tilt'), '')
    await h.React.act(async () => input.blur())
    await h.until(() => h.query('.login-glass-wave'), '离开输入框后恢复装饰层')
    await h.render(createShell(true))
    assert.equal(h.query('.login-glass-wave'), null, '2FA 弹窗期间按公开 paused 输入暂停')
    await h.render(createShell(false))
    await h.until(() => h.query('.login-glass-wave'), '关闭 2FA 弹窗后恢复装饰层')
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: true })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    assert.equal(h.query('.login-glass-wave'), null)
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: false })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    await h.until(() => h.query('.login-glass-wave'), '前台标签恢复装饰层')
    assert.equal(input.value, 'synthetic-private-input')
    assert.equal(input.type, 'password')
    logo.style.setProperty('--login-logo-wave-y', '2px')
    logo.style.setProperty('--login-logo-wave-tilt', '.1deg')
    await h.unmount()
    assert.equal(logo.style.getPropertyValue('--login-logo-wave-y'), '')
    assert.equal(logo.style.getPropertyValue('--login-logo-wave-tilt'), '')
  })
})

it('玻璃组件卸载移除自身 focus 和 visibility 监听，多次挂载不累积', async () => {
  await withReactHarness(async h => {
    const { LoginGlassEffect } = await import('../frontend/src/shared/react/LoginGlassEffect.tsx')
    const originalAdd = h.window.EventTarget.prototype.addEventListener
    const originalRemove = h.window.EventTarget.prototype.removeEventListener
    const listeners = new Map()
    const tracked = (target, name) => target === h.document && name === 'visibilitychange'
      || target instanceof h.window.Element && target.classList.contains('login-shell') && ['focusin', 'focusout'].includes(name)
    h.window.EventTarget.prototype.addEventListener = function (name, handler, options) {
      if (tracked(this, name)) {
        if (!listeners.has(this)) listeners.set(this, new Map())
        const registered = listeners.get(this)
        if (!registered.has(name)) registered.set(name, new Set())
        registered.get(name).add(handler)
      }
      return originalAdd.call(this, name, handler, options)
    }
    h.window.EventTarget.prototype.removeEventListener = function (name, handler, options) {
      if (tracked(this, name)) listeners.get(this)?.get(name)?.delete(handler)
      return originalRemove.call(this, name, handler, options)
    }
    try {
      for (let version = 0; version < 3; version++) {
        await h.render(h.React.createElement('section', { key: version, className: 'login-shell' }, h.React.createElement(LoginGlassEffect, { paused: true })))
        const shells = [...listeners].filter(([target]) => target instanceof h.window.Element)
        assert.equal(shells.reduce((count, [, events]) => count + [...events.values()].reduce((sum, handlers) => sum + handlers.size, 0), 0), 2, '只允许当前组件的 focusin/focusout 两个监听')
      }
      await h.unmount()
      for (const events of listeners.values()) for (const handlers of events.values()) assert.equal(handlers.size, 0)
    } finally {
      h.window.EventTarget.prototype.addEventListener = originalAdd
      h.window.EventTarget.prototype.removeEventListener = originalRemove
    }
  })
})

it('装饰 ErrorBoundary 捕获组件故障时仅移除装饰，原登录表单仍可输入提交', async () => {
  await withReactHarness(async h => {
    const { ErrorBoundary } = await import('../frontend/src/shared/react/ErrorBoundary.tsx')
    let submits = 0
    function BrokenDecoration() { throw new Error('synthetic decorative failure') }
    const originalError = console.error
    const captured = []
    // React 对已捕获的测试异常仍会输出错误；仅局部收集，并在 finally 原样恢复。
    console.error = (...args) => { captured.push(args) }
    try {
      await h.render(h.React.createElement('section', { className: 'login-shell' },
        h.React.createElement(ErrorBoundary, { decorative: true }, h.React.createElement(BrokenDecoration)),
        h.React.createElement('form', { 'data-preserved-login': true, onSubmit: event => { event.preventDefault(); submits++ } },
          h.React.createElement('input', { type: 'password', name: 'password' }), h.React.createElement('button', { type: 'submit' }, '登录'))))
      assert.ok(captured.length > 0, '应实际触发组件错误，而非测试空装饰')
      assert.equal(h.query('[role="alert"]'), null, '装饰故障不将整页替换成业务错误页')
      await h.input('[name="password"]', 'synthetic-private-input')
      await h.submit('[data-preserved-login]')
      assert.equal(h.require('[name="password"]').value, 'synthetic-private-input')
      assert.equal(submits, 1)
    } finally { console.error = originalError }
  })
})
