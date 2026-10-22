const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const frontendRequire = createRequire(path.resolve(__dirname, '../../frontend/package.json'))
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.resolve(__dirname, '../../vendor/api-enhanced')] }))

// React 必须和生产 TSX 从同一 frontend 安装位置解析，避免两份运行时产生无效 Hook。
const React = frontendRequire('react')
const { act } = React

async function withReactHarness(callback, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  })
  const originals = new Map()
  const replace = (key, value) => {
    if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let root
  let mounted = false
  const frames = new Map()
  let frameId = 0
  try {
    for (const name of ['window', 'document', 'navigator', 'Node', 'NodeList', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLImageElement', 'HTMLDialogElement', 'DocumentFragment', 'SVGElement', 'SVGSVGElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'FormData', 'File', 'FileReader', 'Blob']) {
      replace(name, dom.window[name])
    }
    replace('IS_REACT_ACT_ENVIRONMENT', true)
    // 控件几何由浏览器回归验收；JSDOM 仅提供观察器生命周期，不伪造尺寸或拖动结果。
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    dom.window.ResizeObserver = ResizeObserverStub
    replace('ResizeObserver', ResizeObserverStub)
    dom.window.matchMedia = query => ({
      media: query, matches: query.includes('prefers-reduced-motion') || false,
      onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true,
    })
    replace('matchMedia', dom.window.matchMedia)
    replace('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
    // 不驱动真实动画循环；业务仍使用自己的 Audio 注入，不在这里伪造播放器。
    dom.window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId }
    dom.window.cancelAnimationFrame = id => frames.delete(id)
    replace('requestAnimationFrame', dom.window.requestAnimationFrame)
    replace('cancelAnimationFrame', dom.window.cancelAnimationFrame)
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
    dom.window.HTMLDialogElement.prototype.close = function () {
      if (!this.open) return
      this.open = false
      this.dispatchEvent(new dom.window.Event('close'))
    }
    dom.window.HTMLElement.prototype.scrollIntoView = function () {}
    dom.window.HTMLElement.prototype.scrollTo = function () {}
    if (options.fetch) dom.window.fetch = options.fetch
    else dom.window.fetch = async url => { throw new Error(`测试未声明网络请求：${url}`) }
    replace('fetch', dom.window.fetch)
    const { createRoot } = frontendRequire('react-dom/client')
    root = createRoot(dom.window.document.querySelector('#app'))
    mounted = true
    const flush = async (turns = 5) => {
      await act(async () => { for (let n = 0; n < turns; n++) await new Promise(resolve => setImmediate(resolve)) })
    }
    const harness = {
      React, window: dom.window, document: dom.window.document, frames,
      render: async node => { await act(async () => root.render(node)); await flush() },
      unmount: async () => { if (mounted) { await act(async () => root.unmount()); mounted = false } },
      flush,
      wait: async milliseconds => { await act(async () => { await new Promise(resolve => setTimeout(resolve, milliseconds)) }); await flush() },
      async until(predicate, message, timeout = 3000) {
        const end = Date.now() + timeout
        while (!predicate() && Date.now() < end) await this.wait(10)
        assert.ok(predicate(), message)
      },
      query: selector => dom.window.document.querySelector(selector),
      require(selector) { const element = this.query(selector); assert.ok(element, `未找到控件 ${selector}`); return element },
      async click(selector) { const element = this.require(selector); assert.equal(element.disabled, false, `控件被禁用 ${selector}`); await act(async () => element.click()); await flush() },
      async input(selector, value) {
        const input = this.require(selector)
        // 绕过 React 自身的 value tracker，走真正原生 input/change 事件。
        const prototype = input instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
        await act(async () => { input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
        await flush()
      },
      async submit(selector) { await act(async () => this.require(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))); await flush() },
    }
    return await callback(harness)
  } finally {
    try { if (mounted) await act(async () => root.unmount()) }
    finally {
      dom.window.close()
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    }
  }
}

module.exports = { withReactHarness }
