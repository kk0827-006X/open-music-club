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

it('斜俯视镜头两秒连续落到工作区，起止缓动且不同屏幕构图一致', async () => {
  const { archiveEntryCamera } = await import('../frontend/src/rhine/archive-entry-camera.ts')
  const { archiveFraming } = await import('../frontend/src/rhine/viewport-layout.ts')
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
  for (const [width, height] of [[1920, 1080], [1440, 1000], [390, 844]]) {
    const target = { yaw: 59 * Math.PI / 180, elevation: 19 * Math.PI / 180, distance: 140,
      span: archiveFraming(width, height, 7.33, 0, false).span, aim: [-1.091, -.045, .481] }
    const start = archiveEntryCamera(0, target), end = archiveEntryCamera(2, target)
    const direction = [-Math.sin(target.yaw) * Math.cos(target.elevation), Math.sin(target.elevation), Math.cos(target.yaw) * Math.cos(target.elevation)]
    const expected = target.aim.map((v, i) => v + direction[i] * target.distance)
    assert.deepEqual(end.aim, target.aim)
    assert.equal(end.span, target.span)
    assert.ok(distance(end.position, expected) < 1e-10, '终点与交互镜头完全相同')
    assert.deepEqual(archiveEntryCamera(3, target), end, '过渡结束不再二次切镜')
    assert.deepEqual(archiveEntryCamera(-1, target), start)
    assert.ok(start.span > end.span, '从中远景进入')
    const startElevation = Math.asin((start.position[1] - start.aim[1]) / target.distance) * 180 / Math.PI
    assert.ok(Math.abs(startElevation - 32) < 1e-10, '首帧是斜俯视，排除贴侧面低角度')
    const frames = Array.from({ length: 121 }, (_, i) => archiveEntryCamera(i / 60, target))
    const steps = frames.slice(1).map((frame, i) => distance(frame.position, frames[i].position))
    assert.ok(steps[0] < Math.max(...steps) / 100)
    assert.ok(steps.at(-1) < Math.max(...steps) / 100)
    assert.ok(Math.max(...steps) < 1, '60fps 采样中没有位置跳变')
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].span <= frames[i - 1].span)
  }
})

it('Gooey 搜索就地展开、聚焦并保留输入，Escape 关闭返回入口', async () => {
  await withReactHarness(async h => {
    const { GooeySearch } = await import('../frontend/src/shared/react/aceternity/GooeySearch.tsx')
    await h.render(h.React.createElement(GooeySearch))
    assert.equal(h.require('[data-nav="search"]').getAttribute('aria-expanded'), 'false')
    await h.click('[data-nav="search"]')
    assert.equal(h.document.activeElement, h.require('input[type="search"]'))
    await h.input('input[type="search"]', '晴天')
    await h.React.act(async () => h.require('input').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    assert.equal(h.require('input').value, '晴天')
    await h.React.act(async () => h.require('input').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(h.require('[data-nav="search"]').getAttribute('aria-expanded'), 'false')
    assert.equal(h.document.activeElement, h.require('[data-nav="search"]'))
  })
})
