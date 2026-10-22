const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { readFrontendSource } = require('./helpers/frontendSource')
const { withReactHarness } = require('./helpers/reactHarness')

const load = relative => import(pathToFileURL(path.resolve(__dirname, '../frontend/src', relative)).href)

const withFlightsHarness = withReactHarness

// 真实 QueueAddFlights 需要一个根节点、一个带 plus 图标的按钮，以及队标/播放器目标。
// 根节点与 React root 分离，便于精确验证捕获监听的添加和移除。
async function mountFlights(harness, options = {}) {
  const { QueueAddFlights } = await load('features/queue/QueueAddFlights.tsx')
  const React = harness.React
  const document = harness.document
  const flightsRoot = options.rootElement || document.createElement('section')
  flightsRoot.id = 'flights-root'
  if (!flightsRoot.isConnected) document.body.append(flightsRoot)
  const button = (id, { plus = true, ...attributes } = {}) => {
    const element = document.createElement('button')
    element.id = id
    element.type = 'button'
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'disabled') element.disabled = value
      else element.setAttribute(name, value)
    }
    if (plus) {
      const glyph = document.createElement('span')
      glyph.setAttribute('data-ui-icon', 'plus')
      glyph.textContent = '＋'
      element.append(glyph)
    } else {
      element.textContent = '普通按钮'
    }
    return element
  }
  flightsRoot.append(
    button('plus'),
    button('disabled-plus', { disabled: true }),
    button('aria-plus', { 'aria-disabled': 'true' }),
    button('plain', { plus: false }),
    button('queue-toggle', { plus: false, 'data-player-queue-toggle': '' }),
    Object.assign(document.createElement('div'), { id: 'player' }),
  )
  flightsRoot.lastChild.setAttribute('data-global-player', '')
  const root = React.createRef()
  root.current = flightsRoot
  const handle = React.createRef()
  await harness.render(React.createElement(QueueAddFlights, {
    ref: handle,
    root,
    reduced: options.reduced === true,
    reveal: options.reveal || (() => {}),
    finish: options.finish || (() => {}),
  }))
  return { handle, plus: flightsRoot.querySelector('#plus'), rootElement: flightsRoot }
}

describe('入队飞行动画（真实 React 组件）', () => {
  it('一次加号点击只消费一次入队飞行，真实 React 状态生成并清理粒子', async () => {
    await withFlightsHarness(async harness => {
      const flightsRoot = harness.document.createElement('section')
      harness.document.body.append(flightsRoot)
      const clickCaptures = new Set()
      const rawAdd = flightsRoot.addEventListener.bind(flightsRoot)
      const rawRemove = flightsRoot.removeEventListener.bind(flightsRoot)
      flightsRoot.addEventListener = (type, handler, options) => {
        if (type === 'click' && options === true) clickCaptures.add(handler)
        return rawAdd(type, handler, options)
      }
      flightsRoot.removeEventListener = (type, handler, options) => {
        if (type === 'click' && options === true) clickCaptures.delete(handler)
        return rawRemove(type, handler, options)
      }

      let reveals = 0
      let finishes = 0
      const { handle } = await mountFlights(harness, {
        rootElement: flightsRoot,
        reveal: () => reveals++,
        finish: () => finishes++,
      })
      const click = async id => {
        await harness.React.act(async () => {
          harness.require(`#${id}`).dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }))
          // 与生产事件委托一致，在同一点击任务内入队；不能等 0ms 起点回收后才调用。
          handle.current.added()
        })
        await harness.flush()
      }
      const added = async () => {
        await harness.React.act(async () => { handle.current.added() })
        await harness.flush()
      }

      // 禁用、aria-disabled、没有 plus 图标的按钮都不能建立飞行起点。
      await click('disabled-plus'); await added()
      await click('aria-plus'); await added()
      await click('plain'); await added()
      assert.equal(harness.document.querySelectorAll('.queue-add-flight').length, 0)
      assert.equal(reveals, 0)
      assert.equal(handle.current.active, false)

      // 一次点击只产生一次起点；同一任务里重复调用 added 不会重复入队。
      await click('plus')
      await added()
      await added()
      assert.equal(harness.document.querySelectorAll('.queue-add-flight').length, 1)
      assert.equal(reveals, 1)
      assert.equal(handle.current.active, true)
      assert.equal(finishes, 0, 'Motion 动画未完成前不应提前收尾')

      // 每次新的真实点击允许再飞一个；视觉上最多保留 6 个飞行粒子。
      for (let index = 0; index < 6; index++) { await click('plus'); await added() }
      const flights = [...harness.document.querySelectorAll('.queue-add-flight')]
      assert.equal(flights.length, 6)
      assert.ok(flights.every(flight => flight.getAttribute('aria-hidden') === 'true'))
      assert.ok(flights.every(flight => flight.querySelector('[data-ui-icon="plus"]')))
      assert.equal(reveals, 7)

      // 卸载必须移除捕获监听，React 同时清空所有飞行节点。
      const controller = handle.current
      assert.equal(clickCaptures.size, 1)
      await harness.unmount()
      assert.equal(clickCaptures.size, 0)
      assert.equal(harness.document.querySelectorAll('.queue-add-flight').length, 0)
      // useImperativeHandle 的 ref 在卸载后会置空，因此提前保留控制器对象。
      assert.equal(controller.active, false)
      flightsRoot.remove()
    })
  })

  it('减少动态效果时不创建飞行粒子，也不展开播放器', async () => {
    await withFlightsHarness(async harness => {
      let reveals = 0
      const { handle, plus } = await mountFlights(harness, { reduced: true, reveal: () => reveals++ })
      await harness.React.act(async () => {
        plus.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      await harness.flush()
      await harness.React.act(async () => { handle.current.added() })
      await harness.flush()
      assert.equal(harness.document.querySelectorAll('.queue-add-flight').length, 0)
      assert.equal(reveals, 0)
      assert.equal(handle.current.active, false)
    })
  })

  it('入队弧线从点击位置出发，抛起后落入目标', async () => {
    const { queueFlightFrames } = await load('features/queue/add-animation.ts')
    const frames = queueFlightFrames({ x: 100, y: 200 }, { x: 500, y: 600 })
    assert.equal(frames.length, 13)
    assert.match(frames[0].transform, /translate\(0px, 0px\)/)
    assert.match(frames.at(-1).transform, /translate\(400px, 400px\)/)
    assert.equal(frames.at(-1).opacity, 0)
    assert.ok(frames.some(frame => /, -\d/.test(frame.transform)))
  })

  it('飞行动画保持 pointer-events: none，不拦截页面的下一次点击', () => {
    const css = readFrontendSource('frontend/src/style.css')
    assert.match(css, /\.queue-add-flight\s*\{[^}]*pointer-events: none/s)
    // 禁用按钮不进入 hover 反馈，和上面“禁用加号不产生飞行”的行为一致。
    assert.match(css, /button:not\(:disabled\):not\(\[aria-disabled="true"\]\):is\(:hover, :focus-visible\)/)
  })
})
