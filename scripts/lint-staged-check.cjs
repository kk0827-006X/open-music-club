const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { isFormatFile } = require('./format.cjs');
const root = path.resolve(__dirname, '..');

function stagedCommands(files) {
  const formatted = files.filter(isFormatFile);
  const frontend = formatted.filter((file) =>
    /^frontend\/src\/.*\.tsx?$/.test(path.relative(root, file)),
  );
  const commands = [];
  if (formatted.length)
    commands.push([require.resolve('prettier/bin/prettier.cjs'), '--write', '--', ...formatted]);
  if (frontend.length)
    commands.push([
      path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js'),
      '--no-warn-ignored',
      '--',
      ...frontend,
    ]);
  commands.push([
    require.resolve('tsx/cli'),
    '--tsconfig',
    'frontend/tsconfig.json',
    '--test',
    '--test-concurrency=1',
    'tests/frontendFileSize.test.js',
    'tests/frontendArchitecture.test.js',
    'tests/frontendLint.test.js',
  ]);
  return commands;
}

if (require.main === module) {
  const files = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean)
    .map((file) => path.join(root, file));
  for (const args of stagedCommands(files)) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, OMC_STAGED_CHECK: '1' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}

module.exports = { stagedCommands };
