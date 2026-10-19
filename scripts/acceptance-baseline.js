const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

// 顺序执行并保留真实退出码；不把管道中 tail/tee 的成功误当成测试成功。
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'artifacts/baseline')
fs.mkdirSync(output, { recursive: true })
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trim()
const sourceHash = createHash('sha256')
// 工作区尚未提交时也给出代码指纹；只读工程输入，不读取环境、数据库或 storage。
const inputs = (git('ls-files', '-z', '--cached', '--others', '--exclude-standard') || '').split('\0')
  .filter(name => /^(src\/|frontend\/(src\/|public\/|package\.json$|tsconfig\.json$|vite\.config\.ts$)|tests\/|scripts\/|\.github\/|package\.json$|pnpm-(lock|workspace)\.yaml$|\.node-version$|playwright\.config\.js$)/.test(name)).sort()
for (const name of new Set(inputs)) {
  if (fs.existsSync(path.join(root, name))) sourceHash.update(`${name}\0`).update(fs.readFileSync(path.join(root, name))).update('\0')
}
const report = {
  startedAt: new Date().toISOString(), node: process.version,
  pnpm: spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).stdout?.trim(),
  platform: `${process.platform}/${process.arch}`, head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  dirty: Boolean(git('status', '--porcelain')),
  sourceSha256: sourceHash.digest('hex'),
  lockfileSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))).digest('hex'),
  steps: [], success: false,
}
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
const steps = [
  ['install', ['install', '--frozen-lockfile']],
  ['build', ['build:web']],
  ['unit-integration', ['test']],
  ['coverage', ['test:coverage']],
  ['browser-install', ['exec', 'playwright', 'install', '--only-shell', 'chromium']],
  ['browser', ['test:e2e']],
]
save()
for (const [name, args] of steps) {
  const log = path.join(output, `${name}.log`), file = fs.openSync(log, 'w')
  const start = Date.now()
  console.log(`验收：pnpm ${args.join(' ')}（日志 artifacts/baseline/${name}.log）`)
  const result = spawnSync('pnpm', args, { cwd: root, env: { ...process.env, CI: 'true' }, stdio: ['ignore', file, file] })
  fs.closeSync(file)
  const passed = result.status === 0 && !result.error
  report.steps.push({ name, command: `pnpm ${args.join(' ')}`, exitCode: result.status, signal: result.signal, durationMs: Date.now() - start, passed })
  save()
  if (!passed) {
    console.error(`验收未通过：${name}。查看 ${log}`)
    process.exitCode = result.status || 1
    break
  }
}
report.finishedAt = new Date().toISOString()
report.success = report.steps.length === steps.length && report.steps.every(step => step.passed)
save()
console.log(`验收${report.success ? '通过' : '失败'}，结果保存在 artifacts/baseline/summary.json`)
