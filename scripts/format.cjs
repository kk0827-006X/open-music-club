const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const exactFiles = new Set([
  '.prettierrc.json',
  'eslint.config.mjs',
  'lint-staged.config.cjs',
  'package.json',
  'components.json',
  'playwright.config.js',
  '.pnpmfile.cjs',
  'pnpm-workspace.yaml',
  '.github/workflows/acceptance.yml',
  'frontend/index.html',
  'frontend/vite.config.ts',
  'frontend/tsconfig.json',
  'frontend/package.json',
  'frontend/public/theme-init.js',
  'frontend/public/theme.css',
]);

// 格式化入口和 lint-staged 共用固定范围，不遍历整个仓库。
function isFormatFile(file) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  if (relative === 'frontend/src/rhine/motion.ts') return false;
  return (
    exactFiles.has(relative) ||
    /^(?:src|scripts|tests)\/.*\.(?:js|cjs|mjs)$/.test(relative) ||
    /^tests\/.*\.html$/.test(relative) ||
    /^frontend\/src\/.*\.(?:ts|tsx|css)$/.test(relative)
  );
}

function formatFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && isFormatFile(file));
}

if (require.main === module) {
  const mode = process.argv[2];
  if (!['--write', '--check', '--list'].includes(mode)) {
    throw new Error('请选择 --write、--check 或 --list');
  }
  const files = formatFiles();
  if (mode === '--list') console.log(files.join('\n'));
  else {
    const result = spawnSync(
      process.execPath,
      [require.resolve('prettier/bin/prettier.cjs'), mode, ...files],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}

module.exports = { isFormatFile, formatFiles };
