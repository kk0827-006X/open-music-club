const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')

describe('本地前后端联调环境', () => {
  it('Vite 只监听本机并将 API 转发到本地后端', async () => {
    const configPath = path.join(projectRoot, 'frontend/vite.config.ts')
    const moduleUrl = `${pathToFileURL(configPath).href}?test=${Date.now()}`
    const { createViteConfig } = await import(moduleUrl)
    const config = createViteConfig({
      apiTarget: 'http://127.0.0.1:3999',
    })

    assert.equal(config.server.host, '127.0.0.1')
    assert.equal(config.server.port, 5173)
    assert.equal(config.server.strictPort, true)
    assert.deepEqual(config.server.proxy, {
      '/api': { target: 'http://127.0.0.1:3999' },
      '/health': { target: 'http://127.0.0.1:3999' },
    })
  })

  it('根项目提供同时启动前后端及单独启动命令', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    )

    assert.equal(packageJson.scripts['dev:api'], 'node --watch src/server.js')
    assert.equal(packageJson.scripts['dev:web'], 'pnpm --dir frontend dev')
    assert.match(packageJson.scripts.dev, /concurrently/)
  })
})
