const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

it('右侧专辑资料初始隐藏，浏览和悬停不展示，点击档案后才展示并保留选择同步', async () => {
  await withReactHarness(async h => {
    const { LibraryView } = await import('../frontend/src/features/music-library/LibraryView.tsx')
    const ref = h.React.createRef(), selections = [], sceneSelections = []
    const scene = { ready: true, select: (...args) => sceneSelections.push(args), setMode() {}, wake() {}, finishDecryption() {} }
    const render = active => h.render(h.React.createElement('main', { 'data-album-archive': true }, h.React.createElement(LibraryView, {
      ref, scene, active, actions: { play: async () => {}, enqueue() {} }, onSelected: album => selections.push(album), onModeChanged() {},
    })))
    await render(true)
    assert.equal(h.require('[data-album-information]').hidden, true)
    await h.React.act(async () => ref.current.navigate('row', 1))
    assert.equal(h.require('[data-album-information]').hidden, true)
    await h.React.act(async () => ref.current.selectRecord(2, { cell: { lane: 0, row: 14 } }))
    assert.equal(h.require('[data-album-information]').hidden, false)
    assert.equal(h.require('[data-album-information] h2').textContent, ref.current.selectedAlbum.title)
    assert.ok(sceneSelections.length >= 2)
    assert.ok(selections.length >= 3, '隐藏面板期间仍保留原选择和播放器预览同步')
    await render(false); assert.equal(h.require('[data-album-information]').hidden, true)
    await render(true); assert.equal(h.require('[data-album-information]').hidden, false)
  })
})


it('ENTER SYSTEM 只结束 SVG 展示，取消原计时且不重复触发完成回调', async () => {
  await withReactHarness(async h => {
    const { AuthorizedSequence } = await import('../frontend/src/features/auth/AuthorizedSequence.tsx')
    let completed = 0
    await h.render(h.React.createElement(AuthorizedSequence, { role: 'user', onComplete: () => completed++ }))
    await h.click('.sequence-enter')
    await h.click('.sequence-enter')
    assert.equal(completed, 1)
    assert.equal(h.frames.size, 0)
  })
})
