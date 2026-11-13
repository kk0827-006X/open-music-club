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

it('个人音乐页及拆出的 hook、展示组件均不超过 350 行', () => {
  const files = Object.entries(frontendSizes()).filter(([name]) =>
    name.startsWith('features/user/'),
  );
  assert.ok(files.length > 0);
  for (const [name, lines] of files)
    assert.ok(lines <= 350, `${name} 为 ${lines} 行，超过 350 行目标`);
});

it('Workspace 入口不超过 100 行', () => {
  const lines = frontendSizes()['app/Workspace.tsx'];
  assert.ok(Number.isInteger(lines) && lines <= 100, `Workspace 为 ${lines} 行，超过 100 行目标`);
});

it('App 顶层入口不超过 80 行', () => {
  const lines = frontendSizes()['app/App.tsx'];
  assert.ok(Number.isInteger(lines) && lines <= 80, `App 为 ${lines} 行，超过 80 行目标`);
});

it('scene 入口不超过 800 行，状态、资源连接和帧计算边界完整', () => {
  const fs = require('node:fs');
  const files = [
    'scene.ts',
    'scene-update.ts',
    'scene-state.ts',
    'scene-runtime.ts',
    'interaction-bindings.ts',
    'scene-assets.ts',
    'renderer-setup.ts',
  ];
  const source = fs.readFileSync('frontend/src/rhine/scene.ts', 'utf8');
  assert.ok(countLines(source) <= 800, `scene 为 ${countLines(source)} 行，超过 800 行目标`);
  for (const file of files) assert.ok(fs.statSync(`frontend/src/rhine/${file}`).isFile(), file);
  // 记录本轮确认的七个职责模块，避免无意遗漏连接或引入未约定的场景子模块。
  for (const file of files) {
    const imports = fs
      .readFileSync(`frontend/src/rhine/${file}`, 'utf8')
      .matchAll(/from ['"]\.\/(scene[^'"]*|interaction-bindings|renderer-setup)['"]/g);
    for (const [, name] of imports)
      assert.ok(files.includes(`${name}.ts`), `发现额外拆分文件 ${name}`);
  }
});
