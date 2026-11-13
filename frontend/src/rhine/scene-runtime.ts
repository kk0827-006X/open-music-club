import * as THREE from 'three';
import { ArchiveVisibility } from './archive-visibility';
import type { LightingLook } from './archive-lighting';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { poolCell, COLUMN_SPACING, ROW_SPACING, type ArchiveCell } from './archive-loop';
import { ArchiveSceneAssets } from './scene-assets';
import { ArchiveRendererSetup } from './renderer-setup';
import { baselineSelectionWave } from './motion';
import { createSceneState } from './scene-state';

export interface SceneRuntimeOptions {
  readonly container: HTMLElement;
  readonly selectionPulse: typeof baselineSelectionWave;
  readonly deferSelectionPulse: boolean;
  readonly lightingLook: LightingLook;
  readonly coverUrls: readonly string[];
  readonly onCoverUpdate: () => void;
}

// 统一连接逻辑状态与资源所有者；保留所有消耗随机种子的 Three.js 对象分配次序。
export class ArchiveSceneRuntime {
  readonly state = createSceneState();
  readonly inputEvents = new AbortController();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 5, 300);
  readonly visibility = new ArchiveVisibility();
  readonly assets = new ArchiveSceneAssets({
    scene: this.scene,
    renderer: () => this.rendering.renderer,
    isDisposed: () => this.state.lifecycle.disposed,
    isLoaded: () => this.state.lifecycle.loaded,
    markLoaded: () => {
      this.state.lifecycle.loaded = true;
    },
    lightingLook: () => this.options.lightingLook,
    coverUrls: () => this.options.coverUrls,
    subduedIndex: () => this.state.presentation.subduedIndex,
    selectedPosition: () => this.cellPosition(poolCell(this.state.navigation.selectedSlot)),
    appendCells: (cell) => {
      this.state.navigation.cells.push(cell);
    },
    onCoverUpdate: () => {
      this.state.render.renderState.invalidate();
      this.options.onCoverUpdate();
    },
  });
  readonly scratch = {
    cursor: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    dummy: new THREE.Object3D(),
  };
  readonly smaa = new SMAAPass();
  readonly rendering: ArchiveRendererSetup;
  cancelPointer = () => {};
  constructor(readonly options: SceneRuntimeOptions) {
    this.rendering = new ArchiveRendererSetup({
      container: options.container,
      scene: this.scene,
      camera: this.camera,
      cameraAim: this.state.navigation.cameraAim,
      smaa: this.smaa,
      lightingLook: options.lightingLook,
      signal: this.inputEvents.signal,
      renderState: this.state.render.renderState,
      superPerformance: () => this.state.presentation.superPerformance,
    });
    this.scene.add(this.assets.model);
  }
  cellPosition(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * COLUMN_SPACING,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING,
    );
  }
  emitPulse(cell: ArchiveCell) {
    this.state.selection.pulses.push({ ...cell, time: this.state.timing.clock });
    this.state.selection.pulses = this.state.selection.pulses.slice(-6);
  }
  get themeAmount() {
    return this.state.presentation.theme.background(performance.now() / 1000);
  }
}
