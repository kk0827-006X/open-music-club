const assert = require('node:assert/strict')
const { it } = require('node:test')
it('返回档案只释放独有标签与材质，不释放仍被选中档案共享的封面', async () => {
  const THREE = await import('../frontend/node_modules/three/build/three.module.js')
  const { CardAppearance } = await import('../frontend/src/rhine/appearance.ts')
  const group = new THREE.Group(), cover = new THREE.Texture(), material = new THREE.MeshBasicMaterial({ map: cover })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material); mesh.userData.preserveArtwork = true; group.add(mesh)
  let textures = 0, materials = 0
  cover.addEventListener('dispose', () => textures++); material.addEventListener('dispose', () => materials++)
  new CardAppearance().dispose(group)
  assert.equal(textures, 0); assert.equal(materials, 0)
  material.dispose(); cover.dispose(); mesh.geometry.dispose()
})
it('Graphics 不导入具体专辑业务目录，封面通过宿主输入', () => {
  const fs = require('node:fs')
  for (const file of ['scene.ts','data.ts']) assert.doesNotMatch(fs.readFileSync(`frontend/src/rhine/${file}`, 'utf8'), /from ['"]\.\.\/album-data/)
  const host = fs.readFileSync('frontend/src/graphics/archive/scene-host.ts', 'utf8')
  assert.match(host, /options.covers/)
})
it('场景释放对共享资源去重，并释放环境贴图的 RenderTarget 所有者', async () => {
  const THREE = await import('../frontend/node_modules/three/build/three.module.js')
  const { disposeThreeTree } = await import('../frontend/src/rhine/three-resources.ts')
  const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(), material = new THREE.MeshBasicMaterial(), target = new THREE.WebGLRenderTarget(1, 1)
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material))
  scene.environment = target.texture; scene.userData.archiveEnvironment = target
  let g = 0, m = 0, rt = 0
  geometry.addEventListener('dispose', () => g++); material.addEventListener('dispose', () => m++); target.addEventListener('dispose', () => rt++)
  disposeThreeTree(scene)
  assert.equal(g, 1); assert.equal(m, 1); assert.equal(rt, 1)
  assert.equal(scene.children.length, 0)
})
