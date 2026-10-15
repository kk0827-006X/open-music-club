const assert = require('node:assert/strict')
const { it } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [require('node:path').resolve('vendor/api-enhanced')] }))
const tick = () => new Promise(resolve => setImmediate(resolve))

for (const outcome of ['abort', 'late-success']) it(`上传页面销毁后不更新已移除的 DOM（${outcome}）`, async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' })
  const names = ['window', 'document', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'FormData', 'AbortController']
  const originals = Object.fromEntries(names.map(key => [key, global[key]]))
  for (const name of names) global[name] = dom.window[name]
  let finish, fail, requestSignal
  const response = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  dom.window.fetch = async (url, options) => {
    if (url.includes('csrf')) return { ok: true, json: async () => ({ csrfToken: 'test-token' }) }
    requestSignal = options.signal
    return response
  }
  let view
  try {
    const { mountUploadPage } = await import('../frontend/src/features/upload/upload-page.ts')
    const root = dom.window.document.querySelector('#app')
    view = mountUploadPage(root)
    const fileInput = root.querySelector('[data-upload-file]')
    Object.defineProperty(fileInput, 'files', { value: [new dom.window.File(['RIFF'], 'test.wav', { type: 'audio/wav' })] })
    fileInput.dispatchEvent(new dom.window.Event('change'))
    const until = Date.now() + 3000
    while (root.querySelector('[data-upload-submit]').disabled && Date.now() < until) await tick()
    assert.equal(root.querySelector('[data-upload-submit]').disabled, false)
    root.querySelector('[data-upload-artist]').value = '测试歌手'
    root.querySelector('[data-upload-form]').dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    await tick()
    assert.ok(requestSignal)
    // 缓存仅用于将销毁后的危险 DOM 访问转化成可断言计数，避免未捕获异常终止测试。
    const query = root.querySelector.bind(root), retained = new Map()
    for (const selector of ['[data-upload-choose]', '[data-upload-cover-choose]', '[data-upload-remove]', '[data-upload-submit]', '[data-upload-selected-row]', '[data-upload-form]', '[data-upload-file-status]']) retained.set(selector, query(selector))
    view.destroy()
    assert.equal(requestSignal.aborted, true)
    assert.equal(root.childElementCount, 0)
    let lateReads = 0
    root.querySelector = selector => { lateReads++; return retained.get(selector) || query(selector) }
    if (outcome === 'abort') { const error = new Error('已取消'); error.name = 'AbortError'; fail(error) }
    else finish({ ok: true, json: async () => ({ success: true, track: { source: 'local', sourceId: '1', coverUrl: null } }) })
    await tick(); await tick()
    assert.equal(lateReads, 0, '请求完成/取消后不能更新已经销毁的上传视图')
  } finally {
    view?.destroy(); dom.window.close()
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
})
