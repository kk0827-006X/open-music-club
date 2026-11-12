import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SharedDepthAO, SharedDepthBokeh } from './shared-depth';
import { createArchiveLighting, type LightingLook } from './archive-lighting';
import { normalizeQuality, type RenderQuality } from './render-quality';
import { applyTextureQuality, resizeQuality } from './quality-renderer';
import type { RenderState } from './render-state';

interface RendererSetupContext {
  container: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraAim: THREE.Vector3;
  smaa: SMAAPass;
  lightingLook: LightingLook;
  signal: AbortSignal;
  renderState: RenderState;
  superPerformance: () => boolean;
}

// 保留后处理通道的创建次序，景深始终读取画质切换后的当前 AO 通道。
export class ArchiveRendererSetup {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  ao: SharedDepthAO;
  readonly bokeh: SharedDepthBokeh;
  readonly light: THREE.DirectionalLight;
  private quality = normalizeQuality(undefined);
  private appliedQuality = '';
  private aoKernelSize = 32;
  private displayHeight = 0;
  private layoutKind = '';
  constructor(private readonly context: RendererSetupContext) {
    const { container, lightingLook } = context;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.5) * Math.min(innerWidth / 1920, innerHeight / 1080),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    // 同一帧所有后处理通道使用相同几何体；主渲染生成阴影，深度和法线通道复用。
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '三维专辑档案阵列，点击选择，左右拖动切列，上下拖动或滚轮切换列内专辑',
    );
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => this.context.renderState.invalidate(),
      { signal: this.context.signal },
    );
    this.context.scene.background = new THREE.Color('#eae5e1');
    // 模拟后统一更新世界矩阵，后续主渲染、法线、深度和透射通道复用。
    this.context.scene.matrixWorldAutoUpdate = false;
    this.context.scene.fog = new THREE.Fog('#eae5e1', 22, 47);
    this.light = createArchiveLighting(this.renderer, this.context.scene, lightingLook);
    this.light.castShadow = true;
    Object.assign(this.light.shadow.camera, {
      left: -16,
      right: 16,
      top: 15,
      bottom: -15,
      near: 0.1,
      far: 45,
    });
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.normalBias = lightingLook === 'refined' ? 0.018 : 0.035;
    this.light.shadow.bias = lightingLook === 'refined' ? -0.00012 : -0.0003;
    this.light.shadow.radius = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: '#d8c9b9', roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'archive-floor';
    floor.position.y = -4.63;
    floor.receiveShadow = true;
    this.context.scene.add(floor);
    this.context.camera.position.set(-62.26, 35.98, 43.28);
    this.context.cameraAim.set(-0.5, 1.1, 0.4);
    this.context.camera.fov = 6.15;
    this.context.camera.lookAt(this.context.cameraAim);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.context.scene, this.context.camera));
    this.ao = new SharedDepthAO(
      this.context.scene,
      this.context.camera,
      container.clientWidth,
      container.clientHeight,
    );
    this.ao.kernelRadius = lightingLook === 'refined' ? 0.44 : 0.38;
    this.ao.minDistance = 0.001;
    this.ao.maxDistance = 0.09;
    this.composer.addPass(this.ao);
    this.bokeh = new SharedDepthBokeh(
      this.context.scene,
      this.context.camera,
      {
        focus: 25,
        aperture: 0.0018,
        maxblur: 0.011,
      },
      () => this.ao,
    );
    this.composer.addPass(this.bokeh);
    this.context.smaa.enabled = false;
    this.composer.addPass(this.context.smaa);
    this.composer.addPass(new OutputPass());
  }
  setQuality(value: RenderQuality | boolean) {
    const quality =
      typeof value === 'boolean' ? normalizeQuality(undefined, value) : normalizeQuality(value);
    const key = JSON.stringify(quality);
    if (this.appliedQuality === key) return;
    this.appliedQuality = key;
    this.quality = quality;
    if (quality.aoSamples && quality.aoSamples !== this.aoKernelSize) {
      const old = this.ao;
      this.ao = new SharedDepthAO(this.context.scene, this.context.camera, 1, 1, quality.aoSamples);
      this.ao.kernelRadius = old.kernelRadius;
      this.ao.minDistance = old.minDistance;
      this.ao.maxDistance = old.maxDistance;
      const index = this.composer.passes.indexOf(old);
      this.composer.removePass(old);
      this.composer.insertPass(this.ao, index);
      old.dispose();
      this.aoKernelSize = quality.aoSamples;
    }
    this.ao.enabled = quality.aoSamples > 0;
    this.bokeh.enabled = quality.depthOfField > 0;
    this.context.smaa.enabled = quality.antialias === 'smaa';
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    const size = Math.min(quality.shadows || 1024, this.renderer.capabilities.maxTextureSize);
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(size, size);
    }
    this.light.shadow.needsUpdate = true;
    applyTextureQuality(this.context.scene, this.renderer, quality);
    this.resize();
  }
  resize() {
    this.context.renderState.invalidate();
    const w = this.context.container.clientWidth,
      h = this.context.container.clientHeight;
    const kind = this.context.container.closest<HTMLElement>('[data-layout]')?.dataset.layout ?? '';
    const displayHeight = this.context.container.getBoundingClientRect().height;
    if (this.layoutKind === 'cinematic' && kind !== 'cinematic' && this.displayHeight > 0) {
      // 移除上下黑边时保持模型表观大小，再沿原相机插值过渡到响应式锚点。
      this.context.camera.fov = THREE.MathUtils.radToDeg(
        2 *
          Math.atan(
            (Math.tan(THREE.MathUtils.degToRad(this.context.camera.fov / 2)) * displayHeight) /
              this.displayHeight,
          ),
      );
    }
    this.displayHeight = displayHeight;
    this.layoutKind = kind;
    const dimensions = resizeQuality(
      this.renderer,
      this.composer,
      this.context.container,
      this.quality,
      this.context.superPerformance(),
    );
    this.ao.setSize(
      Math.max(1, Math.floor(dimensions.width * this.quality.aoResolution)),
      Math.max(1, Math.floor(dimensions.height * this.quality.aoResolution)),
    );
    this.ao.setSharing(
      this.ao.enabled &&
        this.bokeh.enabled &&
        this.quality.aoResolution === 1 &&
        !this.context.superPerformance(),
    );
    this.context.container.dataset.renderQuality = JSON.stringify({
      ...JSON.parse(this.context.container.dataset.renderQuality!),
      aoSamples: this.ao.enabled ? this.aoKernelSize : 0,
      aoWidth: this.ao.width,
      aoHeight: this.ao.height,
      shadows: this.renderer.shadowMap.enabled ? this.light.shadow.mapSize.x : 0,
      depthOfField: this.bokeh.enabled ? this.quality.depthOfField : 0,
    });
    this.context.camera.aspect = w / h;
    this.context.camera.updateProjectionMatrix();
  }
  get currentQuality() {
    return this.quality;
  }
}
