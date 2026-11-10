const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { it } = require('node:test');

it('提交检查只读取暂存快照，完整保留未暂存与未跟踪文件', { timeout: 30000 }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-staged-check-'));
  const git = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'pipe' });
  try {
    const source = path.join(folder, 'frontend/src/app');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.join(folder, 'frontend/src/features'), { recursive: true });
    fs.mkdirSync(path.join(folder, '.hooks'));
    git('init', '-q');
    git('config', 'user.name', '隔离提交夹具');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.hooksPath', '.hooks');
    const committed = 'export const value = 1;\n';
    fs.writeFileSync(path.join(source, 'Accepted.ts'), committed);
    fs.writeFileSync(path.join(source, 'Unstaged.ts'), committed);
    const helper = path.resolve('scripts/frontend-ratchet.cjs');
    fs.writeFileSync(
      path.join(folder, 'check.cjs'),
      `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const { frontendSizes } = require(${JSON.stringify(helper)});
      assert.deepEqual(frontendSizes(process.cwd()), { 'app/Accepted.ts': 1, 'app/Unstaged.ts': 1 });
      assert.equal(fs.readFileSync('frontend/src/app/Unstaged.ts', 'utf8'), ${JSON.stringify(committed)});
    `,
    );
    fs.writeFileSync(
      path.join(folder, 'lint-staged.config.cjs'),
      "module.exports = { '*': () => 'node check.cjs' };\n",
    );
    git('add', '.');
    git('commit', '-qm', '隔离夹具初始状态');
    const accepted = 'export const value = 2;\n';
    fs.writeFileSync(path.join(source, 'Accepted.ts'), accepted);
    git('add', 'frontend/src/app/Accepted.ts');
    const unstaged = 'export const value = 3;\n' + '\n'.repeat(450);
    fs.writeFileSync(path.join(source, 'Unstaged.ts'), unstaged);
    fs.writeFileSync(path.join(source, 'Untracked.ts'), unstaged);
    const manifest = require.resolve('lint-staged/package.json');
    const result = spawnSync(
      process.execPath,
      [
        path.join(path.dirname(manifest), 'bin/lint-staged.js'),
        '--hide-unstaged',
        '--cwd',
        folder,
        '--config',
        path.join(folder, 'lint-staged.config.cjs'),
      ],
      {
        cwd: folder,
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, OMC_STAGED_CHECK: '1' },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(path.join(source, 'Accepted.ts'), 'utf8'), accepted);
    assert.equal(fs.readFileSync(path.join(source, 'Unstaged.ts'), 'utf8'), unstaged);
    assert.equal(fs.readFileSync(path.join(source, 'Untracked.ts'), 'utf8'), unstaged);
    assert.equal(
      git('diff', '--cached', '--name-only').toString().trim(),
      'frontend/src/app/Accepted.ts',
    );
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
