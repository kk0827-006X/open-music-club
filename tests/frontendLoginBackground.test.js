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

it('React 字符背景层在减少动态效果时保持静态，不更换背景、不遮挡输入及 Logo', async () => {
  await withReactHarness(async h => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    installLoginStyles(h.document)
    await h.render(h.React.createElement(LoginPage))
    const shell = h.require('[data-login-shell]')
    shell.style.backgroundColor = 'rgb(231, 229, 223)'
    const effect = h.require('[data-login-background]')
    assert.equal(effect.getAttribute('aria-hidden'), 'true')
    assert.equal(h.window.getComputedStyle(effect).pointerEvents, 'none')
    assert.equal(effect.querySelectorAll('button, input, a, [tabindex], canvas, .letter-glitch').length, 0)
    assert.equal(h.query('[data-login-background] .archive-brand'), null, 'Logo 不是字符背景遮罩的内部替代品')
    assert.equal(h.document.querySelectorAll('.archive-brand').length, 1)
    await h.input('[name="password"]', 'synthetic-private-input')
    await h.click('[data-reveal-password]')
    assert.equal(h.require('[name="password"]').value, 'synthetic-private-input')
    assert.equal(h.require('[name="password"]').type, 'text')
    assert.equal(h.window.getComputedStyle(shell).backgroundColor, 'rgb(231, 229, 223)')
    assert.equal(h.query('.letter-glitch'), null, '减少动态效果时不加载字符组件')
  })
})

it('登录页聚焦、输入和打开申请弹窗保持同一个字符背景，后台标签仍释放资源', async () => {
  await withReactHarness(async h => {
    h.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    h.window.HTMLCanvasElement.prototype.getContext = () => null
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx')
    await h.render(h.React.createElement(LoginPage))
    const canvas = h.require('.letter-glitch canvas')
    const logo = h.require('.archive-brand')
    await h.React.act(async () => h.require('[name="email"]').focus())
    await h.input('[name="email"]', 'synthetic@example.test')
    assert.equal(h.require('.letter-glitch canvas'), canvas)
    await h.React.act(async () => h.require('[name="password"]').focus())
    await h.input('[name="password"]', 'synthetic-private-input')
    assert.equal(h.require('.letter-glitch canvas'), canvas)
    await h.click('[data-reveal-password]')
    assert.equal(h.require('.letter-glitch canvas'), canvas)
    await h.click('[data-application-open]')
    assert.equal(h.require('.letter-glitch canvas'), canvas, '弹窗打开也不重建背景')
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: true })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    assert.equal(h.query('.letter-glitch'), null)
    Object.defineProperty(h.document, 'hidden', { configurable: true, value: false })
    await h.React.act(async () => h.document.dispatchEvent(new h.window.Event('visibilitychange')))
    await h.until(() => h.query('.letter-glitch'), '前台标签恢复装饰层')
    assert.equal(h.require('[name="password"]').value, 'synthetic-private-input')
    assert.equal(h.require('.archive-brand'), logo)
  })
})

it('字符背景组件只监听可见性，卸载后不累积监听', async () => {
  await withReactHarness(async h => {
    const { LoginBackgroundEffect } = await import('../frontend/src/shared/react/LoginBackgroundEffect.tsx')
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
        await h.render(h.React.createElement('section', { key: version, className: 'login-shell' }, h.React.createElement(LoginBackgroundEffect)))
        assert.equal(listeners.get(h.document)?.get('visibilitychange')?.size, 1)
        const shells = [...listeners].filter(([target]) => target instanceof h.window.Element)
        assert.equal(shells.length, 0, '不再注册输入聚焦监听')
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
