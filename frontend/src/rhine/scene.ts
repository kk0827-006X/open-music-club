import * as THREE from 'three';
import { disposeThreeTree } from './three-resources';
import { type MusicBands, type RhythmStyle } from './archive-play-motion';
import type { LightingLook } from './archive-lighting';
import type { RenderQuality } from './render-quality';
import { fileAtSlot, fileLocation } from './data';
import {
  cellKey,
  sameCell,
  selectionCell,
  fileAtCell,
  COLUMN_SPACING,
  ROW_SPACING,
  type ArchiveCell,
  type ArchiveNavigation,
} from './archive-loop';
import { type DragAxis, type DragProjection, type DragPosition } from './archive-drag';
import { assetUrl as publicAsset } from './asset-url';
import { bindArchiveInteractions } from './interaction-bindings';
import { extraction, baselineSelectionWave } from './motion';
import { ArchiveSceneUpdate, type CinematicUpdate } from './scene-update';
import { ArchiveSceneRuntime } from './scene-runtime';
import type { SceneState } from './scene-state';

const ease = (t: number) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export class ArchiveScene {
  private readonly runtime: ArchiveSceneRuntime;
  private readonly frame: ArchiveSceneUpdate;
  private get state() {
    return this.runtime.state;
  }
  get scene() {
    return this.runtime.scene;
  }
  get camera() {
    return this.runtime.camera;
  }
  get renderer() {
    return this.runtime.rendering.renderer;
  }
  get themeAmount() {
    return this.runtime.themeAmount;
  }
  get uiOnlyParallax() {
    return this.state.presentation.uiOnlyParallax;
  }
  set uiOnlyParallax(value: SceneState['presentation']['uiOnlyParallax']) {
    this.state.presentation.uiOnlyParallax = value;
  }
  get onRelayPick() {
    return this.state.callbacks.onRelayPick;
  }
  set onRelayPick(value: SceneState['callbacks']['onRelayPick']) {
    this.state.callbacks.onRelayPick = value;
  }
  get onCoverUpdate() {
    return this.state.callbacks.onCoverUpdate;
  }
  set onCoverUpdate(value: SceneState['callbacks']['onCoverUpdate']) {
    this.state.callbacks.onCoverUpdate = value;
  }
  get onSelect() {
    return this.state.callbacks.onSelect;
  }
  set onSelect(value: SceneState['callbacks']['onSelect']) {
    this.state.callbacks.onSelect = value;
  }
  get onHover() {
    return this.state.callbacks.onHover;
  }
  set onHover(value: SceneState['callbacks']['onHover']) {
    this.state.callbacks.onHover = value;
  }
  get onNavigate() {
    return this.state.callbacks.onNavigate;
  }
  set onNavigate(value: SceneState['callbacks']['onNavigate']) {
    this.state.callbacks.onNavigate = value;
  }
  update(time: number, cinematic?: CinematicUpdate) {
    this.frame.update(time, cinematic);
  }
  setPresentationVisible(visible: boolean, immediate = false) {
    this.state.presentation.presenceTarget = Number(visible);
    if (immediate) this.state.presentation.presence = this.state.presentation.presenceTarget;
    if (!visible) this.runtime.cancelPointer();
  }
  get presentationHidden() {
    return this.state.presentation.presenceTarget === 0 && this.state.presentation.presence === 0;
  }
  revealImmediately() {
    this.state.presentation.reveal = this.state.presentation.targetReveal;
  }
  dispose() {
    if (this.state.lifecycle.disposed) return;
    this.state.lifecycle.disposed = true;
    this.runtime.inputEvents.abort();
    this.runtime.cancelPointer();
    disposeThreeTree(this.runtime.scene);
    this.runtime.assets.appearance.disposeSources();
    this.runtime.assets.model.clear();
    this.state.selection.outgoing = [];
    this.runtime.assets.instances = [];
    this.runtime.rendering.light.shadow.map?.dispose();
    for (const pass of this.runtime.rendering.composer.passes) pass.dispose();
    this.runtime.rendering.composer.dispose();
    this.runtime.rendering.renderer.dispose();
    this.runtime.rendering.renderer.forceContextLoss();
    this.runtime.rendering.renderer.domElement.remove();
    this.state.lifecycle.loaded = false;
    this.runtime.assets.fallbackCover?.dispose();
    this.runtime.assets.coverTextures = [];
    this.runtime.assets.coverInstances = [];
  }
  setSuperPerformance(enabled: boolean) {
    if (this.state.presentation.superPerformance === enabled) return;
    this.state.presentation.superPerformance = enabled;
    for (const inst of this.runtime.assets.instances) {
      const original = (inst.userData.fullMaterial ??= inst.material) as THREE.MeshPhysicalMaterial;
      if (enabled && !inst.userData.fastMaterial) {
        const fast = original.clone();
        fast.onBeforeCompile = original.onBeforeCompile;
        fast.customProgramCacheKey = original.customProgramCacheKey.bind(original);
        fast.transmission = 0;
        fast.clearcoat = 0;
        fast.roughness = Math.max(0.45, original.roughness);
        inst.userData.fastMaterial = fast;
      }
      inst.material = enabled ? inst.userData.fastMaterial : original;
      inst.visible = !enabled || original.name.replace(/\.\d+$/, '') !== 'Titanium_Fasteners';
    }
    this.resize();
  }
  setSelectedIndexAccent(onlySelected: boolean) {
    this.state.presentation.selectedIndexOnly = onlySelected;
  }
  setTheme(dark: boolean, immediate = false) {
    this.state.presentation.theme.set(
      dark,
      performance.now() / 1000,
      this.state.navigation.selectedCell,
      immediate,
    );
  }
  setAudioBands(bands?: MusicBands) {
    this.state.audio.audioBands = bands;
  }
  setRhythmStyle(style: RhythmStyle) {
    this.state.audio.rhythmStyle = style;
  }
  setPlayfield(
    enabled: boolean,
    bands: MusicBands,
    strength: number,
    flatten: number,
    target: string | null,
    breathing = true,
  ) {
    this.state.audio.playfield = { enabled, bands, strength, flatten, target, breathing };
  }
  setRelayActive(active: boolean) {
    if (active === this.state.relay.relayActive) return;
    this.runtime.cancelPointer();
    this.setHover(null);
    this.state.relay.relayActive = active;
    this.state.interaction.pointer.set(0, 0);
  }
  relayPulse(key: string) {
    const cell = this.state.relay.relayPoints.get(key)?.cell;
    if (cell && !this.state.presentation.reduced) this.runtime.emitPulse(cell);
  }
  projectRelay(key: string) {
    const item = this.state.relay.relayPoints.get(key);
    if (!item) return null;
    const point = item.point.clone().project(this.runtime.camera);
    const rect = this.runtime.rendering.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - point.y) * rect.height) / 2,
    };
  }
  relayCandidates() {
    const rect = this.runtime.rendering.renderer.domElement.getBoundingClientRect();
    this.runtime.scene.updateMatrixWorld(true);
    return [...this.state.relay.relayPoints.keys()].filter((key) => {
      const p = this.projectRelay(key)!;
      const x = (p.x - rect.left) / rect.width,
        y = (p.y - rect.top) / rect.height;
      if (x < 0.18 || x > 0.82 || y < 0.32 || y > 0.76) return false;
      const hit = this.pickCell(p.x, p.y);
      return hit && cellKey(hit) === key;
    });
  }
  setArchiveCoverage(extra: boolean) {
    this.state.render.extraCoverage = extra;
  }
  constructor(
    container: HTMLElement,
    selectionPulse = baselineSelectionWave,
    deferSelectionPulse = false,
    lightingLook: LightingLook = 'baseline',
    coverUrls: readonly string[] = [],
  ) {
    this.runtime = new ArchiveSceneRuntime({
      container,
      selectionPulse: (distance, age) => selectionPulse.call(this, distance, age),
      onCoverUpdate: () => this.onCoverUpdate?.(),
      deferSelectionPulse,
      lightingLook,
      coverUrls,
    });
    this.frame = new ArchiveSceneUpdate(this.runtime, {
      canBrowse: () => this.canBrowse(),
      setHover: (cell) => this.setHover(cell),
      rebaseCoordinates: () => this.rebaseCoordinates(),
      navigatePlane: (coordinate) => this.navigatePlane(coordinate),
      trackPosition: (axis, coordinate) => this.trackPosition(axis, coordinate),
    });
    this.bindPointer();
  }
  load(assetUrl = publicAsset('assets/archive-cassette.glb')) {
    return this.runtime.assets.load(assetUrl);
  }
  async prepareEntry() {
    const canvas = this.runtime.rendering.renderer.domElement;
    canvas.style.visibility = 'hidden';
    try {
      // 先编译材质，再完成真实后处理首帧；这些冷启动工作不占用可见入场的时间轴。
      this.setMode('hidden');
      await this.runtime.rendering.renderer.compileAsync(this.runtime.scene, this.runtime.camera);
      if (this.state.lifecycle.disposed) return;
      this.update(performance.now() / 1000, { time: 21.9, reveal: 0, lift: 0, zoom: 0 });
      const gl = this.runtime.rendering.renderer.getContext();
      if (!('fenceSync' in gl)) return;
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence) return;
      gl.flush();
      await new Promise<void>((resolve) => {
        const deadline = performance.now() + 5000;
        const poll = () => {
          const status =
            this.state.lifecycle.disposed || gl.isContextLost()
              ? gl.WAIT_FAILED
              : gl.clientWaitSync(fence, 0, 0);
          if (
            this.state.lifecycle.disposed ||
            gl.isContextLost() ||
            status !== gl.TIMEOUT_EXPIRED ||
            performance.now() >= deadline
          ) {
            gl.deleteSync(fence);
            resolve();
          } else setTimeout(poll, 8);
        };
        poll();
      });
    } finally {
      canvas.style.visibility = '';
    }
  }
  finishOpening(immediate = false) {
    this.setMode('archive');
    const chosen = this.runtime.cellPosition(this.state.navigation.selectedCell);
    this.state.navigation.columnCamera.value = immediate ? chosen.x : 0;
    this.state.navigation.columnCamera.velocity = 0;
    this.state.navigation.rail.value = immediate ? -2.17 - chosen.z : 0;
    this.state.navigation.rail.velocity = 0;
    this.state.opening.openingMix = immediate ? 0 : 1;
    this.state.opening.openingProgress = 0;
    this.state.opening.openingSnap = immediate;
    this.state.presentation.reveal = this.state.presentation.targetReveal;
    if (immediate) {
      this.state.selection.lift.value = 0.4;
      this.state.selection.lift.velocity = 0;
    }
  }
  setOpeningProgress(progress: number) {
    const next = ease(progress);
    this.state.opening.openingCameraBlend =
      (next - this.state.opening.openingProgress) /
      Math.max(0.000001, 1 - this.state.opening.openingProgress);
    this.state.opening.openingProgress = next;
    this.state.opening.openingMix = 1 - next;
    const chosen = this.runtime.cellPosition(this.state.navigation.selectedCell);
    this.state.navigation.columnCamera.value = chosen.x * next;
    this.state.navigation.columnCamera.velocity = 0;
    this.state.navigation.rail.value = (-2.17 - chosen.z) * next;
    this.state.navigation.rail.velocity = 0;
    this.state.selection.lift.value = 0.4 * next;
    this.state.selection.lift.velocity = 0;
  }
  setMode(mode: 'hidden' | 'archive' | 'detail') {
    this.runtime.cancelPointer();
    this.setHover(null);
    if (mode === 'detail')
      this.state.selection.decryption.enter(
        this.state.selection.scanBlend > 0.9 && this.state.selection.decryption.clarity > 0.999,
      );
    else this.state.selection.decryption.leave();
    if (mode === 'hidden') this.state.selection.decryption.select();
    if (mode !== 'archive') this.state.selection.pendingPulse = null;
    this.state.navigation.looping = mode !== 'hidden';
    if (!this.state.navigation.looping) {
      const canonical = fileLocation(fileAtSlot(this.state.navigation.selectedSlot));
      this.state.navigation.selectedCell = { lane: canonical.lane, row: canonical.row };
      this.state.navigation.coordinateOrigin = { lane: 0, row: 0 };
      for (const old of this.state.selection.outgoing) {
        this.runtime.scene.remove(old.group);
        this.runtime.assets.appearance.dispose(old.group);
      }
      this.state.selection.outgoing = [];
    }
    this.state.navigation.lastInteraction = this.state.timing.clock;
    this.state.presentation.targetReveal = mode === 'hidden' ? 0 : 1;
    this.state.selection.targetDetail = mode === 'detail' ? 1 : 0;
    this.state.interaction.dragging = false;
    if (mode !== 'detail') {
      this.state.selection.targetRotation = 0;
      if (this.state.selection.rotation !== 0)
        this.state.selection.returnY = this.runtime.assets.model.position.y;
    } else this.state.selection.returnY = null;
  }
  setReduced(value: boolean) {
    if (value && !this.state.presentation.reduced) this.runtime.cancelPointer();
    this.state.presentation.reduced = value;
  }
  setQuality(value: RenderQuality | boolean) {
    this.runtime.rendering.setQuality(value);
  }
  private rebaseCoordinates() {
    // Periodically reduce the logical coordinates while preserving every
    // relative position, spring velocity, ripple and idle phase.
    const shift = {
      lane:
        Math.abs(this.state.navigation.selectedCell.lane) > 2048
          ? Math.round((this.state.navigation.selectedCell.lane - 2) / 3) * 3
          : 0,
      row:
        Math.abs(this.state.navigation.selectedCell.row) > 2048
          ? Math.floor((this.state.navigation.selectedCell.row - 12) / 8) * 8
          : 0,
    };
    if (!shift.lane && !shift.row) return;
    this.setHover(null);
    this.state.interaction.hoverLifts.clear();
    this.state.navigation.selectedCell.lane -= shift.lane;
    this.state.navigation.selectedCell.row -= shift.row;
    this.state.navigation.coordinateOrigin.lane += shift.lane;
    this.state.navigation.coordinateOrigin.row += shift.row;
    this.state.navigation.laneFocus.value -= shift.lane;
    this.state.navigation.shoulder.value -= shift.row;
    this.state.navigation.columnCamera.value -= shift.lane * COLUMN_SPACING;
    this.state.navigation.rail.value += shift.row * ROW_SPACING;
    for (const old of this.state.selection.outgoing) {
      old.cell.lane -= shift.lane;
      old.cell.row -= shift.row;
    }
    for (const pulse of this.state.selection.pulses) {
      pulse.lane -= shift.lane;
      pulse.row -= shift.row;
    }
    if (this.state.selection.pendingPulse) {
      this.state.selection.pendingPulse.lane -= shift.lane;
      this.state.selection.pendingPulse.row -= shift.row;
    }
  }
  select(index: number, navigation?: ArchiveNavigation) {
    if (!this.state.interaction.navigatingDrag) this.runtime.cancelPointer();
    this.setHover(null);
    this.state.navigation.lastInteraction = this.state.timing.clock;
    const next = fileLocation(index).slot;
    const canonical = fileLocation(index);
    const cell = this.state.navigation.looping
      ? selectionCell(index, this.state.navigation.selectedCell, navigation)
      : { lane: canonical.lane, row: canonical.row };
    const changed = !sameCell(cell, this.state.navigation.selectedCell);
    if (
      this.state.navigation.looping &&
      changed &&
      this.state.lifecycle.loaded &&
      this.state.selection.lift.value > 0.0001
    ) {
      const group = this.runtime.assets.model.clone(true);
      const label = group.children[group.children.length - 1] as THREE.Mesh;
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 440;
      canvas.getContext('2d')!.drawImage(this.runtime.assets.labelCanvas, 0, 0);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      label.material = new THREE.MeshBasicMaterial({
        map,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      });
      // Clone carries the selected label material by reference. Replace it
      // before installing appearance shaders, so theme hooks are not appended
      // to the original label a second time on every selection.
      this.runtime.assets.appearance.prepare(group);
      this.runtime.assets.appearance.apply(group, ease(this.state.selection.lift.value / 0.4));
      this.runtime.assets.appearance.setClarity(group, this.state.selection.decryption.clarity);
      this.runtime.scene.add(group);
      this.state.selection.outgoing.push({
        group,
        slot: this.state.navigation.selectedSlot,
        cell: { ...this.state.navigation.selectedCell },
        lift: { ...this.state.selection.lift },
        returnY: group.rotation.y !== 0 ? group.position.y : null,
        clarity: this.state.selection.decryption.clarity,
      });
      this.state.selection.lift.value = 0;
      this.state.selection.lift.velocity = 0;
    }
    this.state.navigation.selectedSlot = next;
    this.state.navigation.selectedCell = cell;
    if (changed) {
      this.state.selection.decryption.select();
      this.state.selection.rotation = 0;
      this.state.selection.returnY = null;
    }
    const returning = this.state.selection.outgoing.findIndex((o) => sameCell(o.cell, cell));
    if (returning >= 0) {
      const o = this.state.selection.outgoing[returning];
      this.state.selection.lift = { ...o.lift };
      this.state.selection.rotation = o.group.rotation.y;
      this.state.selection.returnY = o.returnY;
      this.state.selection.decryption.select(o.clarity);
      this.runtime.scene.remove(o.group);
      this.runtime.assets.appearance.dispose(o.group);
      this.state.selection.outgoing.splice(returning, 1);
    }
    if (this.runtime.options.deferSelectionPulse) {
      this.state.selection.pendingPulse = this.state.navigation.looping ? { ...cell } : null;
    } else this.runtime.emitPulse(cell);
    this.state.selection.targetRotation = 0;
    this.drawLabel(index);
  }
  private drawLabel(index: number) {
    this.runtime.assets.drawLabel(index);
  }
  resize() {
    this.runtime.rendering.resize();
  }
  private canBrowse() {
    return (
      this.state.presentation.presenceTarget === 1 &&
      this.state.navigation.looping &&
      !this.state.selection.targetDetail &&
      this.state.selection.detail < 0.2 &&
      this.state.presentation.reveal >= 0.8 &&
      this.state.lifecycle.loaded &&
      !this.runtime.options.container.closest('[inert]')
    );
  }
  private setHover(cell: ArchiveCell | null) {
    if (
      (!cell && !this.state.interaction.hoverCell) ||
      (cell && this.state.interaction.hoverCell && sameCell(cell, this.state.interaction.hoverCell))
    )
      return;
    this.state.interaction.hoverCell = cell ? { ...cell } : null;
    this.onHover?.(cell ? fileAtCell(cell) : null);
  }
  private pickCell(x: number, y: number) {
    const r = this.runtime.rendering.renderer.domElement.getBoundingClientRect();
    this.runtime.scratch.cursor.set(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    this.runtime.scratch.raycaster.setFromCamera(this.runtime.scratch.cursor, this.runtime.camera);
    const hit = this.runtime.scratch.raycaster.intersectObjects(
      [
        this.runtime.assets.instances[0],
        this.runtime.assets.model,
        ...this.state.selection.outgoing.map((o) => o.group),
      ],
      true,
    )[0];
    if (!hit) return null;
    if (hit.instanceId !== undefined) return { ...this.state.render.drawnCells[hit.instanceId] };
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      const copy = this.state.selection.outgoing.find((o) => o.group === object);
      if (copy) return { ...copy.cell };
      object = object.parent;
    }
    return { ...this.state.navigation.selectedCell };
  }
  private trackCoordinate(axis: DragAxis, value: number) {
    return axis === 'lane' ? value / COLUMN_SPACING + 2 : (-value - 2.17) / ROW_SPACING + 15.5;
  }
  private dragProjection(): DragProjection {
    this.runtime.assets.model.updateMatrixWorld(true);
    this.runtime.camera.updateMatrixWorld(true);
    const center = this.runtime.assets.model.localToWorld(new THREE.Vector3(0, 1.85, 0));
    const rect = this.runtime.rendering.renderer.domElement.getBoundingClientRect();
    const project = (motion: THREE.Vector3) => {
      const from = center.clone().addScaledVector(motion, -0.5).project(this.runtime.camera);
      const to = center.clone().addScaledVector(motion, 0.5).project(this.runtime.camera);
      return {
        x: ((to.x - from.x) * rect.width) / 2,
        y: (-(to.y - from.y) * rect.height) / 2,
      };
    };
    // Positive navigation moves the array along -X for columns and -Z for rows.
    return {
      lane: project(new THREE.Vector3(-COLUMN_SPACING, 0, 0)),
      row: project(new THREE.Vector3(0, 0, -ROW_SPACING)),
    };
  }
  private trackPosition(axis: DragAxis, coordinate: number) {
    return axis === 'lane'
      ? (coordinate - 2) * COLUMN_SPACING
      : -2.17 - (coordinate - 15.5) * ROW_SPACING;
  }
  private navigatePlane(coordinate: DragPosition) {
    const goal = { lane: Math.round(coordinate.lane), row: Math.round(coordinate.row) };
    if (sameCell(goal, this.state.navigation.selectedCell)) return;
    const from = { ...this.state.navigation.selectedCell };
    const steps = Math.min(
      64,
      Math.max(Math.abs(goal.lane - from.lane), Math.abs(goal.row - from.row)),
    );
    this.state.interaction.navigatingDrag = true;
    try {
      // Select physical cells along the travelled segment in one update per cell.
      // Column memory is updated by onSelect, but never pulls a held plane away.
      for (let i = 1; i <= steps; i++) {
        const cell = {
          lane: Math.round(from.lane + ((goal.lane - from.lane) * i) / steps),
          row: Math.round(from.row + ((goal.row - from.row) * i) / steps),
        };
        if (!sameCell(cell, this.state.navigation.selectedCell))
          this.onSelect?.(fileAtCell(cell), cell);
      }
    } finally {
      this.state.interaction.navigatingDrag = false;
    }
  }
  private stopMomentum() {
    if (this.state.interaction.archiveMomentum) {
      this.state.navigation.columnCamera.velocity = 0;
      this.state.navigation.rail.velocity = 0;
    }
    this.state.interaction.archiveMomentum = null;
  }
  private bindPointer() {
    const scene = this;
    this.runtime.cancelPointer = bindArchiveInteractions({
      canvas: this.runtime.rendering.renderer.domElement,
      signal: this.runtime.inputEvents.signal,
      pointer: this.state.interaction.pointer,
      archiveDrag: this.state.interaction.archiveDrag,
      columnCamera: this.state.navigation.columnCamera,
      rail: this.state.navigation.rail,
      get relayActive() {
        return scene.state.relay.relayActive;
      },
      get canInspect() {
        return scene.state.selection.canInspect;
      },
      get reduced() {
        return scene.state.presentation.reduced;
      },
      get clock() {
        return scene.state.timing.clock;
      },
      get dragging() {
        return scene.state.interaction.dragging;
      },
      set dragging(value) {
        scene.state.interaction.dragging = value;
      },
      get dragTrack() {
        return scene.state.interaction.dragTrack;
      },
      set dragTrack(value) {
        scene.state.interaction.dragTrack = value;
      },
      get holdingArchive() {
        return scene.state.interaction.holdingArchive;
      },
      set holdingArchive(value) {
        scene.state.interaction.holdingArchive = value;
      },
      get archiveMomentum() {
        return scene.state.interaction.archiveMomentum;
      },
      set archiveMomentum(value) {
        scene.state.interaction.archiveMomentum = value;
      },
      get lastInteraction() {
        return scene.state.navigation.lastInteraction;
      },
      set lastInteraction(value) {
        scene.state.navigation.lastInteraction = value;
      },
      get targetRotation() {
        return scene.state.selection.targetRotation;
      },
      set targetRotation(value) {
        scene.state.selection.targetRotation = value;
      },
      get navigatingDrag() {
        return scene.state.interaction.navigatingDrag;
      },
      set navigatingDrag(value) {
        scene.state.interaction.navigatingDrag = value;
      },
      canBrowse: () => this.canBrowse(),
      stopMomentum: () => this.stopMomentum(),
      setHover: (cell) => this.setHover(cell),
      pickCell: (x, y) => this.pickCell(x, y),
      dragProjection: () => this.dragProjection(),
      trackCoordinate: (axis, value) => this.trackCoordinate(axis, value),
      navigatePlane: (coordinate) => this.navigatePlane(coordinate),
      onSelect: (index, cell) => this.onSelect?.(index, cell),
      onNavigate: (axis, direction) => this.onNavigate?.(axis, direction),
      onRelayPick: (key) => this.onRelayPick?.(key),
    });
  }
  projectCard(x: number, y: number) {
    this.runtime.assets.model.updateMatrixWorld(true);
    const p = this.runtime.assets.model
      .localToWorld(new THREE.Vector3(x, y, 0.255))
      .project(this.runtime.camera);
    return [
      ((p.x + 1) * this.runtime.options.container.clientWidth) / 2,
      ((1 - p.y) * this.runtime.options.container.clientHeight) / 2,
    ];
  }
  get decryptionFrame() {
    return this.state.selection.decryption.frame;
  }
  finishDecryption() {
    this.state.selection.decryption.finish();
  }
  get detailVisibility() {
    return ease((this.state.selection.detail - 0.25) / 0.55);
  }
  getStats() {
    this.runtime.assets.model.updateMatrixWorld(true);
    const project = (x: number, y: number, z: number) => {
      const p = this.runtime.assets.model
        .localToWorld(new THREE.Vector3(x, y, z))
        .project(this.runtime.camera);
      return [
        Math.round(((p.x + 1) * this.runtime.options.container.clientWidth) / 2),
        Math.round(((1 - p.y) * this.runtime.options.container.clientHeight) / 2),
      ];
    };
    return {
      decryption: {
        ...this.state.selection.decryption.frame,
        clarity: this.state.selection.decryption.clarity,
      },
      topLeft: project(-2.5, 3.7, 0),
      topRight: project(2.5, 3.7, 0),
      labelTopLeft: project(-1.855, 3.27, 0.255),
      labelBottomLeft: project(-1.855, 2.81, 0.255),
      modelPosition: this.runtime.assets.model.position
        .toArray()
        .map((v) => Math.round(v * 10000) / 10000),
      cameraPosition: this.runtime.camera.position
        .toArray()
        .map((v) => Math.round(v * 10000) / 10000),
      fieldOfView: this.runtime.camera.fov,
      loaded: this.state.lifecycle.loaded,
      drawCalls: this.runtime.rendering.renderer.info.render.calls,
      renderedFrames: this.state.render.renderedFrames,
      reusedFrames: this.state.render.reusedFrames,
      superPerformance: this.state.presentation.superPerformance,
      presentation: this.state.presentation.presence,
      triangles: this.runtime.rendering.renderer.info.render.triangles,
      archiveCount: this.state.render.drawnCells.length,
      archiveCandidates: this.state.navigation.cells.length,
      archiveCulled: this.state.navigation.cells.length - this.state.render.drawnCells.length,
      archiveCapacity: this.runtime.assets.instanceCapacity,
      archiveCoverage: this.state.render.extraCoverage ? 'extra' : 'standard',
      returningFiles: this.state.selection.outgoing.length,
      selectionPhase: this.state.selection.pendingPulse
        ? 'lifting'
        : this.state.selection.pulses.length
          ? 'wave'
          : 'settled',
      pendingPulse: this.state.selection.pendingPulse
        ? { ...this.state.selection.pendingPulse }
        : null,
      pulses: this.state.selection.pulses.map((pulse) => ({ ...pulse })),
      referenceTime: Math.round((this.state.selection.scanTime + 5) * 100) / 100,
      selectedSlot: this.state.navigation.selectedSlot,
      selectedLane: Math.floor(this.state.navigation.selectedSlot / 32),
      selectedCell: { ...this.state.navigation.selectedCell },
      hoverCell: this.state.interaction.hoverCell ? { ...this.state.interaction.hoverCell } : null,
      hoverLifts: Object.fromEntries(this.state.interaction.hoverLifts),
      dragTrack: this.state.interaction.dragTrack ? { ...this.state.interaction.dragTrack } : null,
      archiveMomentum: this.state.interaction.archiveMomentum
        ? {
            phase: this.state.interaction.archiveMomentum.motion.phase,
            value: this.state.interaction.archiveMomentum.motion.value,
            velocity: this.state.interaction.archiveMomentum.motion.velocity,
          }
        : null,
      holdingArchive: this.state.interaction.holdingArchive,
      dragProjection: this.dragProjection(),
      dragMapping: this.state.interaction.archiveDrag.active ? 'free' : null,
      coordinateOrigin: { ...this.state.navigation.coordinateOrigin },
      poolBounds: {
        minLane: Math.min(...this.state.navigation.cells.map((c) => c.lane)),
        maxLane: Math.max(...this.state.navigation.cells.map((c) => c.lane)),
        minRow: Math.min(...this.state.navigation.cells.map((c) => c.row)),
        maxRow: Math.max(...this.state.navigation.cells.map((c) => c.row)),
      },
      laneFocus: this.state.navigation.laneFocus.value,
      columnCamera: this.state.navigation.columnCamera.value,
      rotation: this.state.selection.rotation,
      clearance: this.state.selection.clearance,
      canInspect: this.state.selection.canInspect,
      returnPhase: this.state.selection.returnY !== null ? 'aligning' : 'lowering',
      extraction: Math.round(this.state.selection.lift.value * 1000) / 1000,
      appearance: Math.round(ease(this.state.selection.lift.value / 0.4) * 1000) / 1000,
      cameraDetail: Math.round(this.state.selection.detail * 1000) / 1000,
      idleGain: this.state.selection.idleGain,
      flatten: this.state.audio.flatMix,
      spectrumActivity: Math.max(
        this.state.audio.playfield.bands.activity,
        this.state.audio.audioBands?.activity ?? 0,
      ),
      audioReactiveGain: this.state.audio.audioGain,
      selectedIndexDim: this.runtime.assets.model.children.find(
        (child) => child.userData.surface === 'Index_Inlay',
      )?.userData.subduedIndex?.value,
      returningIndexDims: this.state.selection.outgoing.map((o) => ({
        cell: o.cell,
        dim: o.group.children.find((child) => child.userData.surface === 'Index_Inlay')?.userData
          .subduedIndex?.value,
      })),
      cameraDistance: this.runtime.camera.position.distanceTo(this.state.navigation.cameraAim),
      cameraNear: this.runtime.camera.near,
      cameraFar: this.runtime.camera.far,
      fogNear: (this.runtime.scene.fog as THREE.Fog).near,
      fogFar: (this.runtime.scene.fog as THREE.Fog).far,
      returningAppearance: this.state.selection.outgoing.map((o) => ({
        slot: o.slot,
        cell: { ...o.cell },
        lift: o.lift.value,
        quality: ease(o.lift.value / 0.4),
        rotation: o.group.rotation.y,
        worldY: o.group.position.y,
        phase: o.returnY !== null ? 'aligning' : 'lowering',
      })),
      rail: Math.round(this.state.navigation.rail.value * 1000) / 1000,
    };
  }
}
