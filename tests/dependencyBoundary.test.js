const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

it('网易云加密不加载 node-forge，且保留原 weapi 协议字节', () => {
  const filename = require.resolve('../vendor/api-enhanced/util/crypto')
  const nativeRequire = createRequire(filename)
  const sandbox = {
    module: { exports: {} }, Buffer,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    require(name) {
      assert.notEqual(name, 'node-forge', '不能重新引入存在未修复签名验证漏洞的依赖')
      return nativeRequire(name)
    },
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 1000 })
  const encrypted = sandbox.module.exports.weapi({ id: 123, csrf_token: '' })
  // 从改动前的实现固定取得，确保更换加密库不改变上游协议。
  assert.equal(encrypted.params, 'CLDD+DdPkibsXQi558ASK3fQufUZOm8UMZu1BjXirW8DhUiezS9M/pwzrGWI5uXc')
  assert.equal(encrypted.encSecKey, 'd473b9eca232f1b4090dd606b0df86de318748dd2eec307e4ed4345030fc4ee30331e598f41d5a6f5befaab94630ea1a1eda7cfade84fbec1a907913d2e4d2c8744bc572b99a050075e075b4537f645ecfa994f95906c32818e076aeda6bdb906bfa0bb96c4cf4bc3ed6d9ab76cf08441153d9d85e1ea3d78fa8d9210d581cee')
  const manifest = require('../vendor/api-enhanced/package.json')
  assert.equal(manifest.dependencies['node-forge'], undefined)
})

it('只裁剪嵌入式网易云包不使用的独立打包和热重载工具', () => {
  const { hooks } = require('../.pnpmfile.cjs')
  const manifest = { name: '@neteasecloudmusicapienhanced/api', dependencies: { axios: '1.20.0' }, devDependencies: { nodemon: '3.1.14', pkg: '5.8.1', mocha: '11.8.0' } }
  const result = hooks.readPackage(structuredClone(manifest))
  assert.deepEqual(result.dependencies, manifest.dependencies)
  assert.deepEqual(result.devDependencies, { mocha: '11.8.0' })
  const own = { ...manifest, name: 'open-music-club' }
  assert.deepEqual(hooks.readPackage(structuredClone(own)), own)
  assert.doesNotThrow(() => hooks.readPackage({ name: manifest.name }))
  assert.ok(fs.existsSync(path.resolve('.github/workflows/acceptance.yml')))
})
