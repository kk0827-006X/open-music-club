const assert = require('node:assert/strict');
const path = require('node:path');
const { it } = require('node:test');
const { isFormatFile, formatFiles } = require('../scripts/format.cjs');

it('格式化只允许固定自有路径，保留算法哈希、资源、文档和运行数据', () => {
  for (const file of [
    'src/app.js',
    'scripts/acceptance-baseline.js',
    'tests/e2e/server.js',
    'tests/fixtures/frontend-refactor.html',
    'frontend/src/app/Workspace.tsx',
    'frontend/src/features/player/PlayerView.tsx',
    'frontend/src/styles/player.css',
    'frontend/public/theme.css',
    'frontend/public/theme-init.js',
    '.github/workflows/acceptance.yml',
    'pnpm-workspace.yaml',
  ])
    assert.equal(isFormatFile(file), true, file);
  for (const file of [
    'frontend/src/rhine/motion.ts',
    'vendor/api-enhanced/app.js',
    'frontend/public/assets/archive-cassette.glb',
    'frontend/public/images/cover.svg',
    'frontend/public/other.js',
    'docs/修改记录.md',
    'AGENTS.md',
    'pnpm-lock.yaml',
    '.env',
    '.env.example',
    'storage/database.sqlite',
    'artifacts/result.json',
    'frontend/dist/assets/app.js',
    '../outside.js',
  ])
    assert.equal(isFormatFile(file), false, file);
  assert.equal(isFormatFile(path.resolve('frontend/src/app/Workspace.tsx')), true);
  assert.ok(formatFiles().length > 100);
  assert.ok(formatFiles().every(isFormatFile));
});
