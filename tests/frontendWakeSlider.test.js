const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')

async function setup(h, initial = 62) {
  const { default: WakeSlider } = await import('../frontend/src/shared/react/react-bits/WakeSlider.tsx')
  const changes = [], state = {}
  function Controlled({ disabled = false }) {
    const [value, setValue] = h.React.useState(initial)
    state.set = setValue
    return h.React.createElement(WakeSlider, { value, disabled, bars: 28, height: 36, restHeight: 6,
      ariaLabel: '音量', formatValue: value => `${value}%`, onChange: value => { changes.push(value); setValue(value) } })
  }
  const render = disabled => h.render(h.React.createElement(Controlled, { disabled }))
  await render(false)
  return { changes, state, render }
}

it('Wake Slider 受控音量、键盘步进和首尾值正确，零音量不点亮条形', async () => {
  await withReactHarness(async h => {
    const { changes, state } = await setup(h)
    const slider = h.require('[role="slider"]')
    const key = name => h.React.act(async () => slider.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })))
    assert.equal(slider.getAttribute('aria-valuenow'), '62')
    assert.equal(slider.getAttribute('aria-valuetext'), '62%')
    await key('ArrowLeft'); await key('PageDown'); await key('Home')
    assert.deepEqual(changes, [61, 51, 0])
    assert.equal(h.document.querySelectorAll('[data-on="true"]').length, 0)
    await key('End'); await key('ArrowRight')
    assert.deepEqual(changes, [61, 51, 0, 100])
    assert.equal(h.document.querySelectorAll('[data-on="true"]').length, 28)
    await h.React.act(async () => state.set(35))
    assert.equal(slider.getAttribute('aria-valuenow'), '35')
    assert.equal(changes.length, 4, '外部同步音量不能再次回调')
    assert.ok([...h.document.querySelectorAll('.wake-slider__bar')].every(bar => bar.style.transform === 'scaleY(0.16666666666666666)'), '减少动态效果时保持静态条形')
  })
})

it('Wake Slider 指针拖动限制范围，忽略其他指针和右键，取消后不再更新', async () => {
  await withReactHarness(async h => {
    const { changes } = await setup(h)
    const track = h.require('.wake-slider__track'), captures = [], releases = []
    track.getBoundingClientRect = () => ({ left: 20, width: 200 })
    track.setPointerCapture = id => captures.push(id)
    track.releasePointerCapture = id => releases.push(id)
    const pointer = async (name, x, id = 1, button = 0) => {
      const event = new h.window.MouseEvent(name, { bubbles: true, clientX: x, button })
      Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } })
      await h.React.act(async () => track.dispatchEvent(event))
    }
    await pointer('pointerdown', 120, 1, 2)
    assert.equal(changes.length, 0)
    await pointer('pointerdown', 70)
    await pointer('pointerdown', 220, 2)
    await pointer('pointermove', 220, 2)
    assert.deepEqual(changes, [25])
    await pointer('pointermove', 500)
    await pointer('pointermove', -10)
    assert.deepEqual(changes, [25, 100, 0])
    await pointer('pointercancel', 20)
    await pointer('pointermove', 120)
    assert.deepEqual(captures, [1])
    assert.deepEqual(releases, [1])
    assert.equal(changes.length, 3)
  })
})

it('Wake Slider 隐藏/禁用时释放拖动，禁止继续修改音量', async () => {
  await withReactHarness(async h => {
    const { changes, render } = await setup(h)
    const track = h.require('.wake-slider__track'), released = []
    track.getBoundingClientRect = () => ({ left: 0, width: 100 })
    track.setPointerCapture = () => {}
    track.releasePointerCapture = id => released.push(id)
    const event = new h.window.MouseEvent('pointerdown', { bubbles: true, clientX: 40, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 3 })
    await h.React.act(async () => track.dispatchEvent(event))
    assert.deepEqual(changes, [40])
    await render(true)
    assert.deepEqual(released, [3])
    const slider = h.require('[role="slider"]')
    assert.equal(slider.disabled, true)
    assert.equal(slider.tabIndex, -1)
    await h.React.act(async () => slider.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    assert.deepEqual(changes, [40])
  })
})
