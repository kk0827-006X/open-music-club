const { it } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

it('业务验收只在首帧和公开场景动作后绘图，保留原选择和参数契约', () => {
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
  const Scene = vm.runInNewContext(source + '\nArchiveScene', { Original })
  const container = { dataset: {} }
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
})
