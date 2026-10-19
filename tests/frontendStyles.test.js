const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { it } = require('node:test')
const { readCss } = require('./helpers/frontendSource')
const postcss = require(require.resolve('postcss', { paths: [require.resolve('../frontend/node_modules/vite/package.json')] }))
it('登录 2FA 弹窗整体缩小为一半，保留居中和原有进出动画', () => {
  const rules = new Map()
  postcss.parse(readCss()).walkRules(rule => {
    if (rule.parent.type !== 'root') return
    if (!rules.has(rule.selector)) rules.set(rule.selector, new Map())
    rule.walkDecls(declaration => rules.get(rule.selector).set(declaration.prop, declaration.value))
  })
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('scale'), '.5')
  assert.equal(rules.get('.login-factor-dialog').get('margin'), 'auto')
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('transform'), undefined)
  assert.match(rules.get('.login-factor-dialog[open]').get('animation'), /settings-enter/)
  assert.match(rules.get('.login-factor-dialog.is-closing').get('animation'), /settings-exit/)
})
it('主题 token 还原后，浅色样式的 2930 条原声明与基线一致', () => {
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /^@import/)
  const colors = new Map(), declarations = []
  postcss.parse(fs.readFileSync('frontend/public/theme.css', 'utf8')).walkRules(rule => {
    if (rule.selector.includes('data-theme="light"')) rule.walkDecls(d => colors.set(d.prop, d.value))
  })
  postcss.parse(readCss()).walkDecls(d => {
    // 旧根颜色变量已移入配置表；三态按钮和新版 2FA 专属样式不属于原布局。
    const selector = d.parent.selector || ''
    if (['--paper', '--ink', '--muted', '--hairline', '--amber'].includes(d.prop) || selector.includes('.settings-theme-options') || /\.factor-(?:challenge|code-|recovery-option)|\.login-factor-dialog\.is-challenge/.test(selector)) return
    const value = d.value.replace(/var\((--[\w-]+)\)/g, (raw, key) => colors.get(key) || raw)
      .replace(/rgba?\(([^)]+)\)/g, (raw, nums) => raw.slice(0, raw.indexOf('(') + 1) + nums.split(',').map(n => Number(n.trim())).join(',') + ')').replace(/\s+/g, '')
    declarations.push([d.parent.selector, d.prop, value])
  })
  assert.equal(declarations.length, 2930)
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(declarations)).digest('hex'), 'bcee388081b6d2ffa751e226ca5dab835a0eccb53950be5bea091aa9abf20a9f')
})
