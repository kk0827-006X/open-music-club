const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { it } = require('node:test')
const { readCss } = require('./helpers/frontendSource')
it('样式按原次序拆分，拼接后与包含用户暂存动效的基线逐字节一致', () => {
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /^@import/)
  assert.equal(crypto.createHash('sha256').update(readCss()).digest('hex'), '6548c2afbd00115b8e66940e05d34187fb65d0d4fd790d730624a03eb69fef9e')
})
