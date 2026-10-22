const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

for (const outcome of ['abort', 'late-success']) it(`上传页面销毁后不更新已移除的 React 视图（${outcome}）`, async () => {
  let finish, fail, requestSignal
  const response = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  const fetch = async (url, options) => {
    if (url.includes('csrf')) return { ok: true, json: async () => ({ csrfToken: 'test-token' }) }
    requestSignal = options.signal
    return response
  }
  await withReactHarness(async (h) => {
    // 组件默认使用 window.fetch；显式写在当前 JSDOM 上，避免测试助手版本差异。
    h.window.fetch = fetch
    const root = h.document.createElement('div')
    h.document.body.appendChild(root)
    const { mountUploadPage } = await import('../frontend/src/features/upload/upload-page.ts')
    const view = mountUploadPage(root)
    let destroyed = false
    try {
      const fileInput = h.require('[data-upload-file]')
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [new h.window.File(['RIFF'], 'test.wav', { type: 'audio/wav' })],
      })
      await h.React.act(async () => {
        fileInput.dispatchEvent(new h.window.Event('change', { bubbles: true }))
      })
      await h.until(() => h.require('[data-upload-submit]').disabled === false, '元数据读取完成后应允许提交')
      await h.input('[data-upload-artist]', '测试歌手')
      await h.submit('[data-upload-form]')
      await h.until(() => Boolean(requestSignal), '提交后应发出上传请求')
      assert.ok(view.element)
      await h.React.act(async () => { view.destroy() })
      destroyed = true
      assert.equal(requestSignal.aborted, true, '销毁页面必须中止上传请求')
      assert.equal(root.childElementCount, 0, '销毁后 React 根节点应被卸载')
      const destroyedMarkup = root.innerHTML
      if (outcome === 'abort') {
        const error = new Error('已取消')
        error.name = 'AbortError'
        fail(error)
      } else {
        finish({
          ok: true,
          json: async () => ({
            success: true,
            track: { source: 'local', sourceId: '1', title: 'test', coverUrl: null },
          }),
        })
      }
      await h.flush()
      assert.equal(root.childElementCount, 0, '请求完成/取消后不能重新挂载已销毁的上传视图')
      assert.equal(root.innerHTML, destroyedMarkup, '请求完成/取消后不能更新已经销毁的上传视图')
    } finally {
      if (!destroyed) view.destroy()
      root.remove()
    }
  }, { fetch })
})
