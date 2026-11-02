const { it } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

it('业务验收按需绘图并保留入场镜头、选择和参数契约', () => {
  const { graphicsProfile } = require('./e2e/graphics-profile')
  let draws = 0
  class Original {
    calls = []
    setQuality() {}
    setSuperPerformance() {}
    update() { draws++ }
    select(...args) { this.calls.push(args) }
    resize() {}
    setMode() {}
    getStats() { return { renderedFrames: draws, selectedCell: { row: 1, lane: 2 } } }
  }
  const source = graphicsProfile('http://127.0.0.1:4317/assets/scene-test.js')
    .replace(/^\s*import[^;]+;/, '').replace('export class', 'class')
  // 浏览器夹具在 VM 中也使用显式浏览器全局；普通业务验收不启用探针。
  const Scene = vm.runInNewContext(source + '\nArchiveScene', { Original, window: {} })
  let phase = ''
  const container = { dataset: {}, closest: () => phase ? { dataset: { entryPhase: phase } } : null }
  const scene = new Scene(container)
  scene.update(0)
  assert.equal(draws, 1)
  scene.update(1.1)
  assert.equal(draws, 1, '没有公开场景动作时不应重复绘图')
  scene.update(1.25)
  assert.equal(draws, 1, '业务流程期间不能恢复连续后台软件绘图')
  scene.select(16, { row: 1, lane: 2 })
  scene.update(2)
  assert.equal(draws, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(scene.calls)), [[16, { row: 1, lane: 2 }]])
  scene.resize()
  scene.update(3)
  assert.equal(draws, 3)
  scene.setMode('archive')
  scene.update(4)
  assert.equal(draws, 4)
  assert.equal(container.dataset.acceptanceFrames, '4')
  scene.update(5, true)
  assert.equal(draws, 5, '镜头过渡显式要求绘图时保留动画')
  phase = 'entering'
  scene.update(6)
  assert.equal(draws, 6, '入场阶段持续绘图')
  phase = 'settling'
  scene.update(7)
  assert.equal(draws, 7, '落定阶段持续绘图')
  phase = 'ready'
  scene.update(8)
  assert.equal(draws, 7, '回到静态阶段后再次停止连续绘图')
})
