const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { it } = require('node:test')
const { pathToFileURL } = require('node:url')
const source = name => fs.readFileSync(path.resolve('frontend/src', name), 'utf8')
const load = name => import(pathToFileURL(path.resolve('frontend/src', name)).href)

it('队列和持久化的共享模型属于中立层，不再引用搜索或个人页面类型', () => {
  assert.match(source('features/queue/model.ts'), /shared\/music\.ts/)
  assert.doesNotMatch(source('features/queue/model.ts'), /music-search|services\/music\/search/)
  assert.doesNotMatch(source('features/queue/persistence.ts'), /music-search|personal-library/)
})

it('实际导入图无运行时循环；Shared、Services 和 Graphics 不反向依赖页面', () => {
  const ts = require('../frontend/node_modules/typescript')
  const root = path.resolve('frontend/src')
  const walkFiles = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walkFiles(path.join(folder, entry.name)) : [path.join(folder, entry.name)])
  const configPath = ts.findConfigFile(path.resolve('frontend'), ts.sys.fileExists, 'tsconfig.json')
  assert.ok(configPath, '必须使用生产 TypeScript 配置解析依赖')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  const graph = new Map()
  const audioOwners = new Set()
  const files = walkFiles(root).filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
  for (const file of files) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const runtime = []
    const dependency = (specifier, runtimeImport) => {
      if (!specifier.startsWith('.') || specifier.endsWith('.css')) return
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
      assert.ok(resolved, `${path.relative(root, file)} 无法解析 ${specifier}`)
      const target = path.resolve(resolved.resolvedFileName)
      const relative = path.relative(root, target)
      const own = path.relative(root, file)
      if (own.startsWith('shared/')) assert.ok(relative.startsWith('shared/'), `${own} 不能依赖 ${relative}`)
      if (own.startsWith('services/')) assert.ok(!relative.startsWith('features/') && !relative.startsWith('app/'), `${own} 不能依赖 ${relative}`)
      if (own.startsWith('rhine/') || own.startsWith('graphics/')) assert.ok(relative.startsWith('rhine/') || relative.startsWith('graphics/') || relative.startsWith('shared/'), `${own} 不能依赖 ${relative}`)
      if (runtimeImport) runtime.push(target)
    }
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        const named = clause?.namedBindings
        const onlyNamedTypes = named && ts.isNamedImports(named) && !clause.name && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly)
        dependency(node.moduleSpecifier.text, !(clause?.isTypeOnly || node.isTypeOnly || onlyNamedTypes))
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text, true)
      if (ts.isNewExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'Audio') || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'Audio'))) audioOwners.add(path.relative(root, file))
      ts.forEachChild(node, visit)
    }
    visit(ast); graph.set(file, runtime)
  }
  const done = new Set(), visiting = new Set()
  const check = file => {
    assert.ok(!visiting.has(file), `运行时循环：${path.relative(root, file)}`)
    if (done.has(file)) return
    visiting.add(file); for(const target of graph.get(file) || []) check(target)
    visiting.delete(file); done.add(file)
  }
  for (const file of graph.keys()) check(file)
  assert.deepEqual([...audioOwners].sort(), ['features/player/player-core.ts'])
})

it('轻量状态按实例隔离，支持查询、通知和取消订阅', async () => {
  const { createState } = await load('shared/state.ts')
  const state = createState({ count: 0 }), other = createState({ count: 0 })
  const seen = []
  const off = state.subscribe(value => seen.push(value.count))
  const first = state.get()
  state.set(first)
  assert.deepEqual(seen, [])
  state.set({ count: 1 })
  off(); off()
  state.set({ count: 2 })
  assert.deepEqual(seen, [1])
  assert.equal(state.get().count, 2)
  assert.equal(other.get().count, 0)
  state.destroy(); state.set({ count: 3 })
  assert.equal(state.get().count, 2)
})

it('共享转义与封面安全校验保持既有输出', async () => {
  const { escapeHtml } = await load('shared/html.ts')
  const { safeCoverUrl } = await load('shared/music.ts')
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;')
  assert.equal(safeCoverUrl('http://p1.music.126.net/cover.jpg'), 'https://p1.music.126.net/cover.jpg')
  assert.equal(safeCoverUrl('/api/local/music/2/cover'), '/api/local/music/2/cover')
  for (const value of ['javascript:alert(1)', '/private/file', null, 'https://evil.test/pic'])
    assert.equal(safeCoverUrl(value), '/images/album-placeholder-01.svg')
})
