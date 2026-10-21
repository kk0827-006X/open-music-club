const { it } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

it('软件渲染验收在帧完成后给真实鼠标操作留出空档，不替换原场景', () => {
  const { graphicsProfile } = require('./e2e/graphics-profile')
  let now = 0, draws = 0
  class Original {
    setQuality() {}
    setSuperPerformance() {}
    update() { draws++; now += 1000 }
  }
  const source = graphicsProfile('http://127.0.0.1:4317/assets/scene-test.js')
    .replace(/^\s*import[^;]+;/, '').replace('export class', 'class')
  const Scene = vm.runInNewContext(source + '\nArchiveScene', { Original, performance: { now: () => now } })
  const scene = new Scene()
  scene.update(0)
  assert.equal(draws, 1)
  now = 1100
  scene.update(1.1)
  assert.equal(draws, 1, '不能按帧开始时间限速，否则慢帧结束后立刻又渲染')
  now = 1250
  scene.update(1.25)
  assert.equal(draws, 2)
})
