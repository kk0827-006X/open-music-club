const assert = require('node:assert/strict');
const { it } = require('node:test');
const fs = require('node:fs');

it('状态工厂无需 DOM 或 WebGL，各场景的所有可变对象独立', async () => {
  const { createSceneState } = await import('../frontend/src/rhine/scene-state.ts');
  assert.equal(typeof document, 'undefined');
  const first = createSceneState(),
    second = createSceneState();
  function assertIndependent(a, b, name) {
    if (!a || typeof a !== 'object') return;
    assert.notEqual(a, b, `${name} 不能跨场景共享`);
    for (const key of Object.keys(a)) assertIndependent(a[key], b[key], `${name}.${key}`);
  }
  assertIndependent(first, second, 'state');
  first.navigation.selectedCell.row = 88;
  first.navigation.rail.value = 10;
  first.selection.pulses.push({ row: 1, lane: 2, time: 3 });
  first.audio.playfield.bands.spectrum = new Float32Array([0.8]);
  first.interaction.hoverLifts.set('1:2', 1);
  first.presentation.theme.set(true, 1, { row: 1, lane: 2 }, true);
  assert.equal(second.navigation.selectedCell.row, 12);
  assert.equal(second.navigation.rail.value, 0);
  assert.equal(second.selection.pulses.length, 0);
  assert.equal(second.audio.playfield.bands.spectrum, undefined);
  assert.equal(second.interaction.hoverLifts.size, 0);
  assert.equal(second.presentation.theme.background(1), 0);
});

it('状态工厂不消耗随机种子，GPU 资源只在 runtime 连接', async () => {
  const { createSceneState } = await import('../frontend/src/rhine/scene-state.ts');
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    calls++;
    return 0.5;
  };
  try {
    createSceneState();
  } finally {
    Math.random = original;
  }
  assert.equal(calls, 0, '状态分组不能改变 Three.js 资源创建所用的随机序列');
  const state = fs.readFileSync('frontend/src/rhine/scene-state.ts', 'utf8');
  assert.doesNotMatch(
    state,
    /scene-assets|renderer-setup|scene-runtime|postprocessing|document\.|new THREE\.(?:Scene|.*Camera|Object3D|.*Mesh|.*Geometry|.*Material|.*Texture)/,
  );
  const update = fs.readFileSync('frontend/src/rhine/scene-update.ts', 'utf8');
  assert.doesNotMatch(
    update,
    /new ArchiveScene(?:Assets|Runtime)|new ArchiveRendererSetup|createSceneState\(/,
  );
  const scene = fs.readFileSync('frontend/src/rhine/scene.ts', 'utf8');
  assert.doesNotMatch(scene, /extends ArchiveSceneUpdate/);
});
