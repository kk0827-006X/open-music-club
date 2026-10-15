const assert = require('node:assert/strict')
const fs = require('node:fs')
const { it } = require('node:test')
const { JSDOM } = require(require.resolve('jsdom', { paths: [require('node:path').resolve('vendor/api-enhanced')] }))

function setup(saved, dark = false, blocked = false) {
  const dom = new JSDOM('<meta name="theme-color"><div id="app"></div>', { url: 'http://localhost', runScripts: 'outside-only' })
  const win = dom.window, media = new win.EventTarget()
  media.matches = dark
  win.matchMedia = () => media
  win.getComputedStyle = () => ({ getPropertyValue: () => win.document.documentElement.dataset.theme === 'dark' ? '#141b1f' : '#efede7' })
  if (saved !== undefined) win.localStorage.setItem('omc.theme', saved)
  if (blocked) Object.defineProperty(win, 'localStorage', { get() { throw new Error('存储被禁用') } })
  const run = () => win.eval(fs.readFileSync('frontend/public/theme-init.js', 'utf8') + '\n//# sourceURL=' + require('node:path').resolve('frontend/public/theme-init.js'))
  const select = preference => win.dispatchEvent(new win.CustomEvent('omc:theme-preference', { detail: preference }))
  const system = next => { media.matches = next; media.dispatchEvent(new win.Event('change')) }
  return { dom, win, media, run, select, system, root: win.document.documentElement }
}

it('早期脚本恢复主题，缺省与损坏偏好保留浅色，重复加载不重复订阅', () => {
  for (const [saved, systemDark, theme] of [[undefined, true, 'light'], ['bad', true, 'light'], ['dark', false, 'dark'], ['system', true, 'dark']]) {
    const env = setup(saved, systemDark)
    try { env.run(); assert.equal(env.root.dataset.theme, theme); assert.equal(env.win.document.querySelector('meta').content, theme === 'dark' ? '#141b1f' : '#efede7') }
    finally { env.dom.window.close() }
  }
  const env = setup('system')
  try {
    let changes = 0; env.win.addEventListener('omc:themechange', () => changes++)
    env.run(); env.run(); const initial = changes
    env.system(true); assert.equal(changes, initial + 1)
  } finally { env.dom.window.close() }
})

it('跟随系统实时响应，显式主题不被系统覆盖，跨标签同步且拒绝非法输入', () => {
  const env = setup('light')
  try {
    env.run(); env.select('system'); env.system(true)
    assert.equal(env.root.dataset.theme, 'dark'); assert.equal(env.root.dataset.themePreference, 'system')
    assert.equal(env.win.localStorage.getItem('omc.theme'), 'system')
    env.select('light'); env.system(false); env.system(true); assert.equal(env.root.dataset.theme, 'light')
    env.select('<script>'); assert.equal(env.root.dataset.themePreference, 'light')
    env.win.dispatchEvent(new env.win.StorageEvent('storage', { key: 'omc.theme', newValue: 'dark', storageArea: env.win.localStorage }))
    assert.equal(env.root.dataset.theme, 'dark')
    env.win.dispatchEvent(new env.win.StorageEvent('storage', { key: null, newValue: null, storageArea: env.win.localStorage }))
    assert.equal(env.root.dataset.theme, 'light')
  } finally { env.dom.window.close() }
})

it('禁用存储不影响当前主题切换；设置按钮通过同一个接口同步状态', async () => {
  const env = setup(undefined, true, true), names = ['window', 'document', 'Element'], originals = Object.fromEntries(names.map(key => [key, global[key]]))
  for (const key of names) global[key] = env.win[key]
  let dialog
  try {
    env.run(); env.select('dark'); assert.equal(env.root.dataset.theme, 'dark'); assert.equal(env.root.dataset.themePersisted, 'false')
    const { mountSettingsDialog } = await import('../frontend/src/features/settings/settings-dialog.ts')
    dialog = mountSettingsDialog(env.win.document.querySelector('#app'), { onOpen() {}, onClose() {} })
    const button = env.win.document.querySelector('[data-theme-preference="system"]')
    assert.ok(button); assert.equal(button.disabled, false); button.click()
    assert.equal(button.getAttribute('aria-pressed'), 'true')
    env.system(false); assert.equal(env.root.dataset.theme, 'light')
    assert.match(env.win.document.querySelector('[data-settings-status]').textContent, /浅色/)
    env.win.document.querySelector('[data-settings-category="account"]').click()
    assert.equal(env.win.document.querySelector('#settings-section-title').textContent, '账号与安全', '根节点主题属性不能截获普通设置按钮')
    dialog.destroy(); dialog = null; env.select('dark')
    assert.equal(env.win.document.querySelector('[data-settings-dialog]'), null)
  } finally {
    dialog?.destroy(); env.dom.window.close()
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
})

it('配置先于模块和界面载入，颜色只在统一表定义，主题模块不接触播放器', () => {
  const html = fs.readFileSync('frontend/index.html', 'utf8')
  assert.ok(html.indexOf('/theme-init.js') > 0 && html.indexOf('/theme-init.js') < html.indexOf('<body>'))
  assert.match(html, /<script src="\/theme-init.js"><\/script>/)
  assert.ok(html.indexOf('/theme.css') < html.indexOf('/theme-init.js'))
  const css = fs.readFileSync('frontend/public/theme.css', 'utf8')
  assert.match(css, /data-theme="dark"/)
  for (const file of fs.readdirSync('frontend/src/styles')) assert.doesNotMatch(fs.readFileSync(`frontend/src/styles/${file}`, 'utf8'), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, file)
  for (const file of ['frontend/public/theme-init.js', 'frontend/src/shared/theme.ts']) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /new Audio|\.pause\(|\.play\(|currentTime|music-workspace|player-core/)
})

it('两套 token 一一对应，新增深色关键文字和操作颜色符合 AA 对比度', () => {
  const postcss = require(require.resolve('postcss', { paths: [require.resolve('../frontend/node_modules/vite/package.json')] }))
  const palettes = []
  postcss.parse(fs.readFileSync('frontend/public/theme.css', 'utf8')).walkRules(rule => {
    if (!rule.selector.includes('data-theme')) return
    const map = new Map(); rule.walkDecls(d => { if (d.prop.startsWith('--')) map.set(d.prop, d.value) }); palettes.push(map)
  })
  assert.deepEqual([...palettes[0].keys()], [...palettes[1].keys()])
  assert.equal(palettes[1].get('--backdrop'), 'rgba(0,0,0,.6)', '深色遮罩应压暗背景，不能变成浅灰发亮的分隔线')
  const luminance = hex => {
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  // 浅色细节通过旧视觉基线校验；不借新增主题重设原有弱化文字颜色。
  for (const colors of [palettes[1]]) for (const [text, bg] of [['--ink','--paper'], ['--muted','--paper'], ['--on-action','--ink'], ['--on-accent','--amber']]) {
    const a = luminance(colors.get(text)), b = luminance(colors.get(bg))
    assert.ok((Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5, `${text} / ${bg}`)
  }
})

it('切换主题不暂停或重建音频，不改曲目、音量、进度及队列', async () => {
  const env = setup('light'), originals = { window: global.window, document: global.document }
  global.window = env.win; global.document = env.win.document
  let created = 0, plays = 0, pauses = 0, player
  class AudioStub extends env.win.EventTarget {
    paused = true; volume = .62; currentTime = 0; duration = 100
    async play() { plays++; this.paused = false; this.dispatchEvent(new env.win.Event('play')) }
    pause() { pauses++; this.paused = true }
    removeAttribute() {} load() {}
  }
  try {
    env.run()
    const { createPlayerController } = await import('../frontend/src/features/player/player-core.ts')
    const { MusicQueue } = await import('../frontend/src/features/queue/model.ts')
    const queue = new MusicQueue(), song = { key: 'local:1', kind: 'song', source: 'local', sourceId: '1', title: '测试' }
    queue.add(song); const audio = new AudioStub()
    player = createPlayerController({ queue, resolveUrl: async () => '/mock', createAudio: () => { created++; return audio } })
    await player.play(song); player.setVolume(.4); player.seek(.42)
    const state = player.get(), pauseCount = pauses
    env.select('dark'); env.select('system'); env.system(true); env.system(false); env.select('light')
    assert.deepEqual(player.get(), state); assert.equal(created, 1); assert.equal(plays, 1); assert.equal(pauses, pauseCount)
    assert.deepEqual(queue.items, [song])
  } finally {
    player?.destroy(); env.dom.window.close()
    for (const [key,value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
})

it('Three.js 复用主题接口，环境和深色材质从同一张 CSS 配置表读取', async () => {
  const env = setup('light'), originals = { window: global.window, document: global.document }
  global.window = env.win; global.document = env.win.document
  const postcss = require(require.resolve('postcss', { paths: [require.resolve('../frontend/node_modules/vite/package.json')] })), colors = {}
  postcss.parse(fs.readFileSync('frontend/public/theme.css', 'utf8')).walkRules(rule => {
    const theme = rule.selector.includes('data-theme="light"') ? 'light' : rule.selector.includes('data-theme="dark"') ? 'dark' : null
    if (!theme) return
    colors[theme] = new Map(); rule.walkDecls(d => colors[theme].set(d.prop, d.value))
  })
  env.win.getComputedStyle = () => ({ getPropertyValue: token => colors[env.root.dataset.theme || 'light'].get(token) || '' })
  let scene
  try {
    env.run()
    const THREE = await import('../frontend/node_modules/three/build/three.module.js')
    const { themeEnvironment, themeMaterial } = await import('../frontend/src/rhine/theme-material.ts')
    scene = new THREE.Scene(); scene.background = new THREE.Color(colors.light.get('--scene-background'))
    const light = new THREE.DirectionalLight(); scene.add(light)
    const renderer = { toneMappingExposure: 1 }
    themeEnvironment(scene, renderer, 0)
    assert.equal(scene.background.getHexString(), colors.light.get('--scene-background').slice(1))
    env.select('dark'); themeEnvironment(scene, renderer, 1)
    assert.equal(scene.background.getHexString(), colors.dark.get('--scene-background').slice(1))
    assert.equal(light.intensity, .65)
    const material = new THREE.MeshStandardMaterial(), amount = themeMaterial(material, 'Frosted_Polymer')
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <roughnessmap_fragment>' }
    material.onBeforeCompile(shader, renderer)
    assert.equal(shader.uniforms.rhineDarkSurface.value.getHexString(), colors.dark.get('--scene-dark-polymer').slice(1))
    assert.equal(amount.value, 0); material.dispose()
    env.select('light'); themeEnvironment(scene, renderer, 0)
    assert.equal(scene.background.getHexString(), colors.light.get('--scene-background').slice(1)); assert.equal(light.intensity, 1)
  } finally {
    scene?.clear(); env.dom.window.close()
    for (const [key,value] of Object.entries(originals)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
})
