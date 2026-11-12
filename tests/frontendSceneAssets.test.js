const assert = require('node:assert/strict');
const { it } = require('node:test');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { withReactHarness } = require('./helpers/reactHarness');
const frontendRequire = createRequire(path.resolve(__dirname, '../frontend/package.json'));

async function withAssets(run) {
  await withReactHarness(async (h) => {
    const THREE = await import('../frontend/node_modules/three/build/three.module.js');
    const { ArchiveSceneAssets } = await import('../frontend/src/rhine/scene-assets.ts');
    const { GLTFLoader } = await import(
      pathToFileURL(frontendRequire.resolve('three/addons/loaders/GLTFLoader.js')).href
    );
    const originalLoad = GLTFLoader.prototype.loadAsync;
    const originalTextureLoad = THREE.TextureLoader.prototype.loadAsync;
    const covers = [];
    const scene = new THREE.Scene();
    let disposed = false,
      loaded = false,
      updates = 0;
    const assets = (() => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image');
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: h.window.Image });
      try {
        return new ArchiveSceneAssets({
          scene,
          renderer: () => ({ capabilities: { getMaxAnisotropy: () => 1 } }),
          isDisposed: () => disposed,
          isLoaded: () => loaded,
          markLoaded: () => {
            loaded = true;
          },
          lightingLook: () => 'baseline',
          coverUrls: () => covers,
          subduedIndex: () => ({ value: 0 }),
          selectedPosition: () => new THREE.Vector3(0, -4.6, -2.17),
          appendCells() {},
          onCoverUpdate: () => updates++,
        });
      } finally {
        if (previous) Object.defineProperty(globalThis, 'Image', previous);
        else delete globalThis.Image;
      }
    })();
    assets.labelMark.decode = async () => {};
    scene.add(assets.model);
    try {
      await run({
        h,
        THREE,
        assets,
        scene,
        GLTFLoader,
        covers,
        setLoaded: (value) => {
          loaded = value;
        },
        setDisposed: (value) => {
          disposed = value;
        },
        get loaded() {
          return loaded;
        },
        get updates() {
          return updates;
        },
      });
    } finally {
      GLTFLoader.prototype.loadAsync = originalLoad;
      THREE.TextureLoader.prototype.loadAsync = originalTextureLoad;
      const { disposeThreeTree } = await import('../frontend/src/rhine/three-resources.ts');
      disposeThreeTree(scene);
      assets.appearance.disposeSources();
    }
  });
}

it('模型迟到时已销毁的场景不接入资源，原始 GLTF 树被释放', async () => {
  await withAssets(async (ctx) => {
    const { THREE, assets, GLTFLoader } = ctx;
    let resolve,
      started = false;
    GLTFLoader.prototype.loadAsync = () => {
      started = true;
      return new Promise((done) => {
        resolve = done;
      });
    };
    const loading = assets.load('/isolated.glb');
    await ctx.h.until(() => started, '应真正开始模型读取');
    const source = new THREE.Group(),
      geometry = new THREE.PlaneGeometry(),
      material = new THREE.MeshStandardMaterial();
    source.add(new THREE.Mesh(geometry, material));
    let geometries = 0,
      materials = 0;
    geometry.addEventListener('dispose', () => geometries++);
    material.addEventListener('dispose', () => materials++);
    ctx.setDisposed(true);
    resolve({ scene: source });
    await loading;
    assert.equal(ctx.loaded, false);
    assert.equal(assets.model.children.length, 0);
    assert.equal(source.children.length, 0);
    assert.equal(geometries, 1);
    assert.equal(materials, 1);
  });
});

it('实例容量增长保留已有矩阵与主题值，并让所有批次共享新缓冲', async () => {
  await withAssets(async ({ THREE, assets, scene }) => {
    const geometry = new THREE.PlaneGeometry(),
      material = new THREE.MeshStandardMaterial();
    assets.instanceCapacity = 1;
    assets.instances = [
      new THREE.InstancedMesh(geometry, material, 1),
      new THREE.InstancedMesh(geometry, material, 1),
    ];
    assets.instances[1].instanceMatrix = assets.instances[0].instanceMatrix;
    assets.instances[0].instanceMatrix.array[12] = 12.5;
    assets.themeAttribute = new THREE.InstancedBufferAttribute(new Float32Array([0.75]), 1);
    assets.instances.forEach((mesh) => scene.add(mesh));
    let releases = 0;
    assets.instances.forEach((mesh) => mesh.addEventListener('dispose', () => releases++));
    assets.ensureInstanceCapacity(3);
    assert.equal(assets.instanceCapacity, 3);
    assert.equal(releases, 2);
    assert.equal(assets.instances[0].instanceMatrix, assets.instances[1].instanceMatrix);
    assert.equal(assets.instances[0].instanceMatrix.array[12], 12.5);
    assert.equal(assets.themeAttribute.array[0], 0.75);
    assert.equal(assets.instances[0].geometry.getAttribute('archiveTheme'), assets.themeAttribute);
    assert.equal(assets.matrixUpdates.attribute, assets.instances[0].instanceMatrix);
    const matrix = assets.instances[0].instanceMatrix;
    assets.ensureInstanceCapacity(2);
    assert.equal(assets.instances[0].instanceMatrix, matrix);
  });
});

it('标签更新同步选中封面并推进贴图版本，不改变阵列封面', async () => {
  await withAssets(async ({ THREE, assets, scene }) => {
    const { records } = await import('../frontend/src/rhine/data.ts');
    const context = { fillRect() {}, fillText() {}, drawImage() {} };
    assets.labelCanvas.getContext = () => context;
    assets.labelTexture = new THREE.CanvasTexture(assets.labelCanvas);
    assets.coverTextures = Array.from({ length: 24 }, () => new THREE.Texture());
    const old = assets.coverTextures[0];
    assets.selectedCover = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ map: old }),
    );
    scene.add(assets.selectedCover);
    const version = assets.labelTexture.version;
    assets.drawLabel(1);
    assert.equal(assets.selectedAlbumIndex, records[1].albumIndex);
    assert.equal(assets.selectedCover.material.map, assets.coverTextures[records[1].albumIndex]);
    assert.equal(assets.coverTextures[0], old);
    assert.ok(assets.labelTexture.version > version);
    assets.coverTextures.forEach((texture) => texture.dispose());
    assets.labelTexture.dispose();
  });
});

it('模型组装失败仍释放 GLTF 原资源，已被场景引用的共享纹理保留', async () => {
  await withAssets(async ({ THREE, assets, GLTFLoader }) => {
    const source = new THREE.Group(),
      shared = new THREE.Texture();
    const first = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial({ map: shared }),
    );
    first.material.name = 'Other_Surface';
    const bad = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    bad.geometry.clone = () => {
      throw new Error('隔离组装失败');
    };
    source.add(first, bad);
    let geometries = 0,
      materials = 0,
      textures = 0;
    for (const mesh of [first, bad]) {
      mesh.geometry.addEventListener('dispose', () => geometries++);
      mesh.material.addEventListener('dispose', () => materials++);
    }
    shared.addEventListener('dispose', () => textures++);
    GLTFLoader.prototype.loadAsync = async () => ({ scene: source });
    await assert.rejects(assets.load('/isolated.glb'), /隔离组装失败/);
    assert.equal(geometries, 2);
    assert.equal(materials, 2);
    assert.equal(textures, 0);
    assert.equal(source.children.length, 0);
    assert.equal(assets.model.children.length, 1);
  });
});

it('远程封面成功时同步阵列和选中封面，失败时保留占位，迟到源纹理被释放', async () => {
  await withAssets(async (ctx) => {
    const { THREE, assets, scene, covers } = ctx;
    covers.push('/success.svg', '/failure.svg', '/late.svg');
    const sources = [new THREE.Texture(), new THREE.Texture()];
    sources.forEach((source) => {
      source.image = {};
    });
    let releases = 0;
    sources.forEach((source) => source.addEventListener('dispose', () => releases++));
    let resolveLate;
    THREE.TextureLoader.prototype.loadAsync = (url) =>
      url === '/success.svg'
        ? Promise.resolve(sources[0])
        : url === '/failure.svg'
          ? Promise.reject(new Error('隔离网络失败'))
          : new Promise((resolve) => {
              resolveLate = resolve;
            });
    const originalContext = ctx.h.window.HTMLCanvasElement.prototype.getContext;
    ctx.h.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    const fallback = new THREE.Texture();
    assets.coverTextures = [fallback, fallback, fallback];
    assets.coverInstances = [0, 1, 2].map(
      () =>
        new THREE.InstancedMesh(
          new THREE.PlaneGeometry(),
          new THREE.MeshBasicMaterial({ map: fallback }),
          1,
        ),
    );
    assets.selectedCover = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ map: fallback }),
    );
    scene.add(...assets.coverInstances, assets.selectedCover);
    ctx.setLoaded(true);
    try {
      assets.startCoverLoading();
      await ctx.h.until(() => ctx.updates === 1, '成功封面应通知场景更新');
      assert.notEqual(assets.coverTextures[0], fallback);
      assert.equal(assets.coverInstances[0].material.map, assets.coverTextures[0]);
      assert.equal(assets.selectedCover.material.map, assets.coverTextures[0]);
      assert.equal(assets.coverTextures[1], fallback);
      assert.equal(releases, 1);
      ctx.setLoaded(false);
      ctx.setDisposed(true);
      resolveLate(sources[1]);
      await ctx.h.until(() => releases === 2, '迟到的源纹理必须释放');
      assert.equal(assets.coverTextures[2], fallback);
      assert.equal(ctx.updates, 1);
    } finally {
      ctx.h.window.HTMLCanvasElement.prototype.getContext = originalContext;
    }
  });
});
