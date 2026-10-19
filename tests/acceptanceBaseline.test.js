const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

for (const failing of [false, true]) it(`验收脚本${failing ? '保留失败退出码并停止后续步骤' : '顺序执行全部步骤并保存版本和锁文件证据'}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-baseline-runner-'))
  try {
    fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'bin'))
    fs.copyFileSync(path.resolve('scripts/acceptance-baseline.js'), path.join(root, 'scripts/acceptance-baseline.js'))
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '测试锁文件')
    const fakePnpm = path.join(root, 'bin/pnpm')
    // 只替换此测试子进程的 pnpm，不安装依赖或接触真实工作区。
    fs.writeFileSync(fakePnpm, `#!${process.execPath}\nconst args=process.argv.slice(2); if(args[0]==='--version') console.log('12.3.4'); else { console.log('测试命令',args.join(' ')); process.exitCode=${failing ? "args[0]==='build:web'?7:0" : '0'} }\n`)
    fs.chmodSync(fakePnpm, 0o755)
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/acceptance-baseline.js')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` },
    })
    assert.equal(result.status, failing ? 7 : 0, result.stderr)
    const report = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/baseline/summary.json'), 'utf8'))
    assert.equal(report.success, !failing)
    assert.equal(report.steps.length, failing ? 2 : 6)
    assert.match(report.lockfileSha256, /^[a-f0-9]{64}$/)
    assert.match(report.sourceSha256, /^[a-f0-9]{64}$/)
    assert.equal(report.node, process.version)
    assert.equal(report.pnpm, '12.3.4')
    assert.equal(report.steps[1].exitCode, failing ? 7 : 0)
    assert.match(fs.readFileSync(path.join(root, 'artifacts/baseline/build.log'), 'utf8'), /build:web/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
