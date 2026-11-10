const assert = require('node:assert/strict');
const { it } = require('node:test');
const {
  MAX_LINES,
  countLines,
  frontendSizes,
  baselineAtBase,
  sizeViolations,
} = require('../scripts/frontend-ratchet.cjs');
const whitelist = require('./fixtures/frontend-file-size.json');

it('features 与 app 全部 TS/TSX 文件受 400 行上限和递减白名单约束', () => {
  assert.equal(MAX_LINES, 400);
  const previous = baselineAtBase('tests/fixtures/frontend-file-size.json');
  assert.deepEqual(sizeViolations(frontendSizes(), whitelist, previous), []);
});

it('行数计入注释和空行，只排除文件末尾换行产生的空项', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('一行\n\n// 注释\n'), 3);
  assert.equal(countLines('一行\r\n\r\n// 注释\r\n'), 3);
  assert.equal(countLines('一行'), 1);
});

it('ratchet 阻止新增超限文件、提高上限和保留已达标例外', () => {
  assert.ok(sizeViolations({ 'features/new.tsx': 401 }, {}, {}).length);
  assert.ok(
    sizeViolations({ 'app/old.tsx': 501 }, { 'app/old.tsx': 501 }, { 'app/old.tsx': 500 }).length,
  );
  assert.ok(sizeViolations({ 'app/new.tsx': 501 }, { 'app/new.tsx': 501 }, {}).length);
  assert.ok(
    sizeViolations({ 'app/old.tsx': 400 }, { 'app/old.tsx': 500 }, { 'app/old.tsx': 500 }).length,
  );
  assert.ok(sizeViolations({}, { 'app/old.tsx': 500 }, { 'app/old.tsx': 500 }).length);
  assert.deepEqual(
    sizeViolations({ 'app/old.tsx': 450 }, { 'app/old.tsx': 450 }, { 'app/old.tsx': 500 }),
    [],
  );
  assert.deepEqual(sizeViolations({ 'app/old.tsx': 400 }, {}, { 'app/old.tsx': 500 }), []);
});
