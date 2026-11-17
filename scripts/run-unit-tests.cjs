const { spawnSync } = require('node:child_process');
const { unitFiles } = require('../tests/helpers/test-suites.cjs');

const files = unitFiles(process.argv[2] || 'business');
if (!files.length) throw new Error('测试分组不能为空');
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'tsx',
    '--tsconfig',
    'frontend/tsconfig.json',
    '--test',
    '--test-concurrency=1',
    ...files,
  ],
  {
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
