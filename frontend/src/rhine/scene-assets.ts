import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CardAppearance } from './appearance';
import { configureInternalOptics } from './internal-optics';
import { themeMaterial } from './theme-material';
import { collectThreeTextures, disposeThreeTree } from './three-resources';
import { InstanceUpdates } from './instance-updates';
import { records } from './data';
import { poolCell, LOOP_COLUMNS, LOOP_ROWS, type ArchiveCell } from './archive-loop';
import { labelMarkSvg } from './brand';
import { assetUrl as publicAsset } from './asset-url';
import type { LightingLook } from './archive-lighting';

interface SceneAssetsContext {
  scene: THREE.Scene;
  renderer: () => Pick<THREE.WebGLRenderer, 'capabilities'>;
  isDisposed: () => boolean;
  isLoaded: () => boolean;
  markLoaded: () => void;
  lightingLook: () => LightingLook;
  coverUrls: () => readonly string[];
  subduedIndex: () => { value: number };
  selectedPosition: () => THREE.Vector3;
  appendCells: (cell: ArchiveCell) => void;
  onCoverUpdate: () => void;
}

// 集中持有场景资源；异步回调通过上下文读取当前生命周期状态。
export class ArchiveSceneAssets {
  instances: THREE.InstancedMesh[] = [];
  coverInstances: THREE.InstancedMesh[] = [];
  coverTextures: THREE.Texture[] = [];
  selectedCover?: THREE.Mesh;
  fallbackCover?: THREE.Texture;
  selectedAlbumIndex = 0;
  matrixUpdates?: InstanceUpdates;
  themeUpdates?: InstanceUpdates;
  instanceCapacity = LOOP_COLUMNS * LOOP_ROWS;
  model = new THREE.Group();
  appearance = new CardAppearance();
  themeAttribute?: THREE.InstancedBufferAttribute;
  labelCanvas = document.createElement('canvas');
  labelTexture?: THREE.CanvasTexture;
  labelMark = new Image();
  constructor(private readonly context: SceneAssetsContext) {}
  async load(assetUrl = publicAsset('assets/archive-cassette.glb')) {
    this.labelMark.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
    await this.labelMark.decode();
    if (this.context.isDisposed()) return;
    const gltf = await new GLTFLoader().loadAsync(assetUrl);
    if (this.context.isDisposed()) {
      disposeThreeTree(gltf.scene);
      return;
    }
    try {
      gltf.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      const count = LOOP_COLUMNS * LOOP_ROWS;
      for (let index = 0; index < count; index++) {
        const cell = poolCell(index);
        this.context.appendCells(cell);
      }
      for (const mesh of meshes) {
        const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).scale(1, 1, 1);
        const source = mesh.material as THREE.MeshStandardMaterial;
        const name = source.name.replace(/\.\d+$/, '');
        const mat = source.clone() as THREE.MeshPhysicalMaterial;
        mat.envMapIntensity = 0.6;
        if (name === 'Frosted_Polymer') {
          mat.color.set('#fffdfa');
          mat.transmission = 0.9;
          mat.thickness = 0.12;
          mat.roughness = 0.21;
          mat.ior = 1.46;
          mat.attenuationColor = new THREE.Color('#eee6df');
          mat.attenuationDistance = 2;
        }
        if (name === 'Internal_Ceramic') {
          mat.color.set(this.context.lightingLook() === 'refined' ? '#c4baae' : '#c7beb6');
          mat.roughness = 0.6;
        }
        if (name === 'Printed_Label') mat.color.set('#eae5dc');
        if (name === 'Ivory_Edges') {
          mat.color.set('#f0e7df');
          mat.roughness = 0.31;
          mat.transmission = 0.65;
          mat.thickness = 0.04;
        }
        if (name === 'Optical_Diffuser') {
          mat.color.set('#e2dad4');
          mat.transmission = 0;
          mat.roughness = 0.7;
        }
        if (name === 'Subsurface_Optics') {
          mat.color.set(this.context.lightingLook() === 'refined' ? '#b9a796' : '#b9aba1');
          mat.roughness = 0.48;
          mat.metalness = 0.05;
        }
        if (name === 'Optical_Edges') {
          // 内部折射肩部必须进入不透明捕获，屏幕空间透射无法递归采样另一玻璃网格。
          mat.transmission = 0;
          mat.color.set(this.context.lightingLook() === 'refined' ? '#d8c7b5' : '#d4c7be');
          mat.roughness = 0.26;
          mat.metalness = 0.08;
        }
        configureInternalOptics(name, mat);
        if (name === 'Carbon_Ink') {
          geom.dispose();
          mat.dispose();
          continue;
        }
        const selectedMesh = new THREE.Mesh(geom, mat);
        selectedMesh.userData.surface = name;
        selectedMesh.castShadow = name === 'Optical_Diffuser';
        selectedMesh.receiveShadow = true;
        this.model.add(selectedMesh);
        // 紧密阵列只保留外壳、边缘和紧固件，细小光学与文字几何体只留在抽出的档案上。
        if (
          ![
            'Frosted_Polymer',
            'Ivory_Edges',
            'Titanium_Fasteners',
            'Index_Inlay',
            'Optical_Diffuser',
          ].includes(name)
        ) {
          this.appearance.register(name, mat);
          continue;
        }
        const arrayMat = mat.clone();
        if (name === 'Frosted_Polymer') {
          arrayMat.transmission = 0.78;
          if (this.context.lightingLook() === 'refined') {
            // 斜向长路径吸收暖色体积色，薄边和抽出的透明外壳保留更亮的响应。
            arrayMat.thickness = 0.28;
            arrayMat.attenuationColor.set('#d4c7b4');
            arrayMat.attenuationDistance = 1.2;
          }
          arrayMat.transparent = false;
          arrayMat.color.set('#fff7ed');
          arrayMat.onBeforeCompile = (shader) => {
            shader.vertexShader = 'varying float vPanelHeight;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvPanelHeight = position.y / 3.7;',
            );
            shader.fragmentShader = 'varying float vPanelHeight;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <color_fragment>',
              '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.40, 0.30, 0.20), vec3(1.0, 0.98, 0.94), smoothstep(0.1, 1.0, vPanelHeight));',
            );
          };
          arrayMat.roughness = 0.28;
          arrayMat.clearcoat = 0.3;
          arrayMat.clearcoatRoughness = 0.25;
        }
        if (name === 'Optical_Diffuser') arrayMat.color.set('#806447');
        if (name === 'Ivory_Edges') {
          arrayMat.transmission = 0;
          arrayMat.color.set(this.context.lightingLook() === 'refined' ? '#dcc9b0' : '#fff5e9');
          arrayMat.roughness = 0.38;
        }
        if (name === 'Index_Inlay') {
          arrayMat.color.set('#e4d6c5');
          arrayMat.metalness = 0.05;
        }
        this.appearance.register(name, mat, arrayMat);
        this.themeAttribute ??= new THREE.InstancedBufferAttribute(
          new Float32Array(count),
          1,
        ).setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('archiveTheme', this.themeAttribute);
        themeMaterial(arrayMat, name, true, this.context.subduedIndex());
        const inst = new THREE.InstancedMesh(geom, arrayMat, count);
        // 各表面刚性同步移动，共享 GPU 变换缓冲。
        inst.instanceMatrix =
          this.instances[0]?.instanceMatrix ?? inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        inst.castShadow = name === 'Optical_Diffuser';
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        this.instances.push(inst);
        this.context.scene.add(inst);
      }
      this.labelCanvas.width = 1024;
      this.labelCanvas.height = 440;
      this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
      this.labelTexture.colorSpace = THREE.SRGBColorSpace;
      this.labelTexture.anisotropy = this.context.renderer().capabilities.getMaxAnisotropy();
      this.fallbackCover = this.createFallbackCover();
      this.coverTextures = Array.from({ length: records.length }, () => this.fallbackCover!);
      const coverGeometry = new THREE.PlaneGeometry(2.65, 2.65);
      coverGeometry.translate(0, 1.85, 0.34);
      for (const texture of this.coverTextures) {
        const instances = new THREE.InstancedMesh(
          coverGeometry,
          new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }),
          count,
        );
        instances.count = 0;
        instances.frustumCulled = false;
        this.coverInstances.push(instances);
        this.context.scene.add(instances);
      }
      this.selectedCover = new THREE.Mesh(
        coverGeometry,
        new THREE.MeshBasicMaterial({
          map: this.coverTextures[0],
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      this.selectedCover.userData.preserveArtwork = true;
      this.model.add(this.selectedCover);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.99, 0.46),
        new THREE.MeshBasicMaterial({
          map: this.labelTexture,
          toneMapped: false,
          transparent: true,
          depthWrite: false,
        }),
      );
      label.position.set(-1.36, 3.04, 0.255);
      this.model.add(label);
      this.appearance.prepare(this.model);
      this.appearance.apply(this.model, 0);
      this.drawLabel(0);
      this.context.scene.add(this.model);
      this.model.position.copy(this.context.selectedPosition());
      this.context.markLoaded();
      this.startCoverLoading();
    } finally {
      // GLTF 原始树不再使用；保留已被实例材质引用的纹理，不释放共享贴图。
      disposeThreeTree(gltf.scene, collectThreeTextures(this.context.scene));
    }
  }
  private createFallbackCover() {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 384;
    const context = canvas.getContext('2d')!;
    const paper = context.createLinearGradient(0, 0, 384, 384);
    paper.addColorStop(0, '#ded7c9');
    paper.addColorStop(1, '#ada696');
    context.fillStyle = paper;
    context.fillRect(0, 0, 384, 384);
    context.strokeStyle = 'rgba(40,39,35,.22)';
    context.strokeRect(20, 20, 344, 344);
    context.beginPath();
    context.arc(192, 187, 86, 0, Math.PI * 2);
    context.moveTo(106, 187);
    context.lineTo(278, 187);
    context.stroke();
    context.fillStyle = '#34332f';
    context.font = 'bold 23px sans-serif';
    context.textAlign = 'center';
    context.fillText('OPEN MUSIC CLUB', 192, 330);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  private startCoverLoading() {
    const loader = new THREE.TextureLoader();
    this.context.coverUrls().forEach((coverUrl, index) => {
      void loader
        .loadAsync(coverUrl)
        .then((source) => {
          try {
            if (!this.context.isLoaded()) return;
            const canvas = document.createElement('canvas');
            canvas.width = 384;
            canvas.height = 384;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.drawImage(source.image as CanvasImageSource, 0, 0, 384, 384);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = this.context.renderer().capabilities.getMaxAnisotropy();
            this.coverTextures[index] = texture;
            const material = this.coverInstances[index].material as THREE.MeshBasicMaterial;
            material.map = texture;
            material.needsUpdate = true;
            if (index === this.selectedAlbumIndex && this.selectedCover) {
              const selectedMaterial = this.selectedCover.material as THREE.MeshBasicMaterial;
              selectedMaterial.map = texture;
              selectedMaterial.needsUpdate = true;
            }
            this.context.onCoverUpdate();
          } finally {
            source.dispose();
          }
        })
        .catch(() => {
          // 远程封面不可用时保留本地生成的占位贴图，不影响档案墙。
        });
    });
  }
  drawLabel(index: number) {
    if (!this.labelTexture) return;
    const c = this.labelCanvas.getContext('2d')!;
    c.fillStyle = '#e6e2d9';
    c.fillRect(0, 0, 1024, 440);
    c.fillStyle = '#171713';
    c.fillRect(12, 12, 1000, 6);
    c.fillRect(12, 419, 1000, 3);
    c.font = 'bold 81px MiSans';
    c.fillText('OPEN MUSIC CLUB', 22, 116);
    c.font = '32px MiSans';
    c.fillStyle = '#878476';
    c.fillText('MUSIC ARCHIVE', 25, 174);
    c.fillStyle = '#171713';
    c.font = 'bold 130px MiSans';
    c.fillText('NO.' + String(index + 1).padStart(3, '0'), 22, 360);
    c.fillRect(782, 32, 221, 39);
    c.fillStyle = '#eee9de';
    c.font = '24px MiSans';
    c.fillText('O M / C', 809, 61);
    c.fillStyle = '#171713';
    c.font = 'bold 64px MiSans';
    c.fillText('INFO', 830, 143);
    c.drawImage(this.labelMark, 790, 242, 210, 98);
    this.labelTexture.needsUpdate = true;
    this.selectedAlbumIndex = records[index].albumIndex;
    if (this.selectedCover) {
      const material = this.selectedCover.material as THREE.MeshBasicMaterial;
      material.map = this.coverTextures[this.selectedAlbumIndex];
      material.needsUpdate = true;
    }
  }
  ensureInstanceCapacity(required: number) {
    if (required <= this.instanceCapacity) return;
    const capacity = Math.max(required, this.instanceCapacity * 2);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16).setUsage(
      THREE.DynamicDrawUsage,
    );
    matrix.array.set(this.instances[0].instanceMatrix.array);
    for (const inst of this.instances) {
      inst.dispose();
      inst.instanceMatrix = matrix;
    }
    const previousTheme = this.themeAttribute;
    this.themeAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity),
      1,
    ).setUsage(THREE.DynamicDrawUsage);
    if (previousTheme) this.themeAttribute.array.set(previousTheme.array);
    for (const inst of this.instances)
      inst.geometry.setAttribute('archiveTheme', this.themeAttribute);
    this.matrixUpdates = new InstanceUpdates(matrix);
    this.themeUpdates = new InstanceUpdates(this.themeAttribute);
    this.instanceCapacity = capacity;
  }
}
