const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { it } = require('node:test')
const { readCss } = require('./helpers/frontendSource')
const postcss = require(require.resolve('postcss', { paths: [require.resolve('../frontend/node_modules/vite/package.json')] }))
it('登录 2FA 弹窗使用独立响应式尺寸，保留居中和原有进出动画', () => {
  const rules = new Map()
  postcss.parse(readCss()).walkRules(rule => {
    if (rule.parent.type !== 'root') return
    if (!rules.has(rule.selector)) rules.set(rule.selector, new Map())
    rule.walkDecls(declaration => rules.get(rule.selector).set(declaration.prop, declaration.value))
  })
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('width'), 'min(420px, calc(100vw - 32px))')
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('scale'), undefined)
  assert.equal(rules.get('.login-factor-dialog').get('margin'), 'auto')
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('transform'), undefined)
  assert.match(rules.get('.login-factor-dialog[open]').get('animation'), /settings-enter/)
  assert.match(rules.get('.login-factor-dialog.is-closing').get('animation'), /settings-exit/)
})
// 基线取自本轮修复前的 c2a9527；按文件锁定近期已提交界面，新增样式不混入旧总数。
// 同时检查声明数、完整内容和导入清单，不能用更新总声明数掩盖既有片段的变化。
it('当前页面与主题样式按文件匹配已审查的声明和内容基线', () => {
  const baseline = require('./fixtures/frontend-style-baseline.json')
  const files = ['frontend/public/theme.css', 'frontend/src/style.css',
    ...fs.readdirSync('frontend/src/styles').filter(name => name.endsWith('.css')).map(name => `frontend/src/styles/${name}`)].sort()
  assert.deepEqual(files, Object.keys(baseline.files).sort(), '新增或删除样式文件需要单独审查')
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    let declarations = 0
    postcss.parse(source).walkDecls(() => { declarations++ })
    assert.equal(declarations, baseline.files[file].declarations, `${file} 声明数发生变化`)
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), baseline.files[file].sha256, `${file} 样式或导入顺序发生变化`)
  }
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /^@import/)
})
