const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { it } = require('node:test')
const { readCss } = require('./helpers/frontendSource')
const postcss = require(require.resolve('postcss', { paths: [require.resolve('../frontend/node_modules/vite/package.json')] }))
it('主题 token 还原后，浅色样式的 2930 条原声明与基线一致', () => {
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /^@import/)
  const colors = new Map(), declarations = []
  postcss.parse(fs.readFileSync('frontend/public/theme.css', 'utf8')).walkRules(rule => {
    if (rule.selector.includes('data-theme="light"')) rule.walkDecls(d => colors.set(d.prop, d.value))
  })
  postcss.parse(readCss()).walkDecls(d => {
    // 旧根颜色变量已移入配置表；新增三态按钮不属于原布局。
    if (['--paper', '--ink', '--muted', '--hairline', '--amber'].includes(d.prop) || d.parent.selector?.includes('.settings-theme-options')) return
    const value = d.value.replace(/var\((--[\w-]+)\)/g, (raw, key) => colors.get(key) || raw)
      .replace(/rgba?\(([^)]+)\)/g, (raw, nums) => raw.slice(0, raw.indexOf('(') + 1) + nums.split(',').map(n => Number(n.trim())).join(',') + ')').replace(/\s+/g, '')
    declarations.push([d.parent.selector, d.prop, value])
  })
  assert.equal(declarations.length, 2930)
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(declarations)).digest('hex'), 'bcee388081b6d2ffa751e226ca5dab835a0eccb53950be5bea091aa9abf20a9f')
})
