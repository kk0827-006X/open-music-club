import * as THREE from 'three';
import { archiveEntryCamera } from './archive-entry-camera';
import { InstanceUpdates } from './instance-updates';
import { themeEnvironment } from './theme-material';
import {
  audioWave,
  interactionGain,
  RhythmMotion,
  rhythmDisplacement,
  quietBands,
} from './archive-play-motion';
import { records } from './data';
import {
  cellKey,
  fileAtCell,
  poolCell,
  COLUMN_SPACING,
  ROW_SPACING,
  type ArchiveCell,
} from './archive-loop';
import { archiveFraming } from './viewport-layout';
import { type DragAxis, type DragPosition } from './archive-drag';
import {
  archiveWave,
  extraction,
  rippleEnvelope,
  settlingWave,
  damp,
  columnStrength,
  idleWave,
  cinematicField,
  INSPECTION_LIFT,
  returnStep,
} from './motion';
import { ArchiveSceneRuntime } from './scene-runtime';
import type { ArchivePlayfield } from './scene-state';

const ease = (t: number) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export type CinematicUpdate = { reveal: number; lift: number; zoom: number; time: number };

type MotionFrame = {
  time: number;
  dt: number;
  cinematic: CinematicUpdate | undefined;
  blend: number;
  shot: number;
  workspaceEntry: boolean;
  referenceCinematic: boolean;
  hoverLift: (cell: ArchiveCell) => number;
  chosen: THREE.Vector3;
  selectedRow: number;
  selectedLane: number;
  trackX: number;
};
type WaveFrame = MotionFrame & {
  play: ArchivePlayfield;
  activePlay: boolean;
  rhythm: ReturnType<RhythmMotion['update']>;
  indexDim: (lift: number) => number;
};
type SelectionFrame = WaveFrame & {
  field: (row: number, lane: number) => number;
  selectedBase: number;
  detail: number;
};
type CameraFrame = { fog: THREE.Fog; responsiveOpening: boolean };

export interface ArchiveSceneControls {
  canBrowse(): boolean;
  setHover(cell: ArchiveCell | null): void;
  rebaseCoordinates(): void;
  navigatePlane(coordinate: DragPosition): void;
  trackPosition(axis: DragAxis, coordinate: number): number;
}

// 只负责单帧计算；共享状态和资源通过显式 runtime 读取，控制动作由场景入口提供。
export class ArchiveSceneUpdate {
  constructor(
    private readonly runtime: ArchiveSceneRuntime,
    private readonly controls: ArchiveSceneControls,
  ) {}
  private get state() {
    return this.runtime.state;
  }
  private presentationDrop(cell: ArchiveCell) {
    const { navigation, presentation } = this.state;

    const delay =
      0.15 *
      (1 +
        Math.tanh(
          (cell.row - navigation.selectedCell.row) * 0.1 +
            (cell.lane - navigation.selectedCell.lane) * 0.25,
        ));
    return 35 * Math.pow(THREE.MathUtils.clamp((1 - presentation.presence - delay) / 0.7, 0, 1), 2);
  }
  update(time: number, cinematic?: CinematicUpdate) {
    const { timing, lifecycle } = this.state;

    const elapsed = Math.max(0, time - timing.last || 0.016);
    const dt = Math.min(elapsed, 0.05);
    timing.last = time;
    timing.clock = time;
    if (!lifecycle.loaded) return;
    // 顺序沿用原实现：波形闭包首次采样早于相机更新，实例裁剪晚于相机矩阵提交。
    this.updateLighting(elapsed);
    const motion = this.updateMotion(time, elapsed, dt, cinematic);
    const wave = this.updateWaveAudio(motion);
    this.updateRelay(wave);
    const field = this.createWaveField(wave);
    const frame = this.updateSelection(wave, field);
    this.updateDecryption(frame);
    const entryZ = this.updateCards(frame);
    const camera = this.updateCamera(frame);
    const matricesChanged = this.updateCardInstances(frame, entryZ, camera);
    const bokehUniforms = this.updateInspection(frame);
    this.renderFrame(frame, matricesChanged, camera.fog, bokehUniforms);
  }
  private updateLighting(elapsed: number) {
    const { presentation } = this.state;
    const { rendering, scene } = this.runtime;

    const step = presentation.reduced ? 1 : Math.min(elapsed, 0.25) / 1.1;
    presentation.presence +=
      Math.sign(presentation.presenceTarget - presentation.presence) *
      Math.min(step, Math.abs(presentation.presenceTarget - presentation.presence));
    rendering.renderer.domElement.style.opacity = String(
      THREE.MathUtils.clamp(presentation.presence / 0.16, 0, 1),
    );
    presentation.theme.beginFrame();
    themeEnvironment(scene, rendering.renderer, this.runtime.themeAmount);
  }
  private updateMotion(
    time: number,
    elapsed: number,
    dt: number,
    cinematic?: CinematicUpdate,
  ): MotionFrame {
    const { presentation, selection, opening, interaction, navigation } = this.state;
    const { options, cancelPointer } = this.runtime;

    const blend = 1 - Math.exp(-dt * (presentation.reduced ? 35 : 2.8));
    presentation.reveal = cinematic
      ? cinematic.reveal
      : THREE.MathUtils.lerp(presentation.reveal, presentation.targetReveal, blend);
    selection.rotation = selection.targetDetail
      ? THREE.MathUtils.lerp(selection.rotation, selection.targetRotation, blend)
      : returnStep(selection.rotation, dt, presentation.reduced);
    const shot = cinematic?.time ?? 29.1;
    const workspaceEntry =
      Boolean(cinematic) && options.container.closest<HTMLElement>('[data-entry-phase]') !== null;
    const referenceCinematic = Boolean(cinematic) && !workspaceEntry;
    if (cinematic) opening.openingMix = 1;
    if (cinematic) {
      opening.openingFieldTime = shot;
      selection.scanTime = shot;
      selection.scanBlend = 1;
    } else {
      selection.scanTime += dt;
      selection.scanBlend *= Math.exp(-dt * 3);
    }
    if (!this.controls.canBrowse()) {
      this.controls.setHover(null);
      if (interaction.holdingArchive || interaction.archiveMomentum) cancelPointer();
    }
    if (
      navigation.looping &&
      !cinematic &&
      !interaction.holdingArchive &&
      !interaction.archiveMomentum
    )
      this.controls.rebaseCoordinates();
    const momentum = !cinematic ? interaction.archiveMomentum : null;
    if (momentum) {
      momentum.motion.step(Math.min(Math.max(time - momentum.time, 0), 0.25));
      momentum.time = time;
      this.controls.navigatePlane(momentum.motion.value);
      navigation.lastInteraction = time;
    }
    const hoverKey = !cinematic && interaction.hoverCell ? cellKey(interaction.hoverCell) : null;
    if (hoverKey && !interaction.hoverLifts.has(hoverKey)) interaction.hoverLifts.set(hoverKey, 0);
    for (const [key, value] of interaction.hoverLifts) {
      const target = key === hoverKey ? 0.28 : 0;
      const next = cinematic
        ? 0
        : presentation.reduced
          ? target
          : THREE.MathUtils.lerp(value, target, 1 - Math.exp(-dt * 14));
      if (target === 0 && next < 0.0001) interaction.hoverLifts.delete(key);
      else interaction.hoverLifts.set(key, next);
    }
    const hoverLift = (cell: ArchiveCell) => interaction.hoverLifts.get(cellKey(cell)) ?? 0;
    const chosen = this.runtime.cellPosition(navigation.selectedCell);
    const selectedRow = navigation.selectedCell.row;
    const selectedLane = navigation.selectedCell.lane;
    damp(navigation.shoulder, selectedRow, presentation.reduced ? 35 : 5, dt);
    damp(navigation.laneFocus, selectedLane, presentation.reduced ? 35 : 4, dt);
    // 按住或自由滑行时由平面控制双轴轨道，选中状态不能将其拉回。
    if (!interaction.holdingArchive && !momentum) {
      damp(navigation.columnCamera, chosen.x, presentation.reduced ? 35 : 3.7, dt);
      damp(navigation.rail, cinematic ? 0 : -2.17 - chosen.z, presentation.reduced ? 35 : 3.7, dt);
    }
    if (momentum) {
      navigation.columnCamera.value = this.controls.trackPosition(
        'lane',
        momentum.motion.lane.value,
      );
      navigation.rail.value = this.controls.trackPosition('row', momentum.motion.row.value);
      navigation.columnCamera.velocity = momentum.motion.lane.velocity * COLUMN_SPACING;
      navigation.rail.velocity = -momentum.motion.row.velocity * ROW_SPACING;
      if (momentum.motion.phase === 'idle') interaction.archiveMomentum = null;
    }
    if (interaction.dragTrack && !cinematic) {
      navigation.columnCamera.value = interaction.dragTrack.lane;
      navigation.rail.value = interaction.dragTrack.row;
      navigation.columnCamera.velocity = navigation.rail.velocity = 0;
    }
    if (cinematic) {
      navigation.rail.value = 0;
      navigation.rail.velocity = 0;
      selection.lift.value = extraction(shot);
      selection.lift.velocity = 0;
      navigation.shoulder.value = selectedRow;
      navigation.laneFocus.value = selectedLane;
      navigation.laneFocus.velocity = 0;
      navigation.columnCamera.value = chosen.x;
      navigation.columnCamera.velocity = 0;
    }
    // 将受光阵列保持在原点附近，横向导航与前后轨道一样移动整个阵列。
    const trackX = cinematic ? 0 : navigation.columnCamera.value;
    return {
      time,
      dt,
      cinematic,
      blend,
      shot,
      workspaceEntry,
      referenceCinematic,
      hoverLift,
      chosen,
      selectedRow,
      selectedLane,
      trackX,
    };
  }
  private updateWaveAudio(frame: MotionFrame): WaveFrame {
    const { selection, presentation, navigation, audio, relay, interaction } = this.state;

    const { time, dt, cinematic } = frame;
    selection.pulses = selection.pulses.filter((p) => time - p.time < 3.2);
    const aligningCopy = selection.outgoing.some((o) => o.returnY !== null);
    const idle =
      !cinematic &&
      !presentation.reduced &&
      presentation.targetReveal > 0 &&
      !selection.targetDetail &&
      selection.detail < 0.01 &&
      selection.returnY === null &&
      !aligningCopy &&
      time - navigation.lastInteraction > 2.5;
    selection.idleGain = cinematic
      ? 0
      : THREE.MathUtils.lerp(
          selection.idleGain,
          idle
            ? audio.playfield.enabled
              ? audio.playfield.breathing && !relay.relayActive
                ? 1 - audio.playfield.bands.activity
                : 0
              : 1 - (audio.audioBands?.activity ?? 0)
            : 0,
          1 - Math.exp(-dt * (idle ? 0.8 : 4)),
        );
    selection.pulseGain = THREE.MathUtils.lerp(
      selection.pulseGain,
      selection.targetDetail || selection.returnY !== null || aligningCopy ? 0 : 1,
      1 - Math.exp(-dt * 8),
    );
    const play = audio.playfield;
    audio.audioGain = interactionGain(
      audio.audioGain,
      interaction.holdingArchive || Boolean(interaction.archiveMomentum),
      Boolean(
        selection.targetDetail ||
        selection.detail > 0.01 ||
        selection.returnY !== null ||
        aligningCopy,
      ),
      dt,
    );
    const activePlay = !cinematic && !selection.targetDetail && play.enabled;
    const rhythm = audio.rhythm.update(
      activePlay && !presentation.reduced ? play.bands : quietBands(),
      time,
      dt,
      audio.rhythmStyle,
    );
    audio.flatMix +=
      ((activePlay ? play.flatten : 0) - audio.flatMix) *
      (presentation.reduced ? 1 : 1 - Math.exp(-dt * 4));
    presentation.subduedIndex.value = Math.max(
      Number(presentation.selectedIndexOnly),
      audio.flatMix,
    );
    const indexDim = (lift: number) =>
      presentation.selectedIndexOnly ? 1 - ease(lift / 0.4) * (1 - audio.flatMix) : audio.flatMix;
    return { ...frame, play, activePlay, rhythm, indexDim };
  }
  private updateRelay(frame: WaveFrame) {
    const { relay, presentation } = this.state;

    const { activePlay, play, dt } = frame;
    const gameTarget = activePlay ? play.target : null;
    if (gameTarget && !relay.relayLifts.has(gameTarget)) relay.relayLifts.set(gameTarget, 0);
    for (const [key, height] of relay.relayLifts) {
      const next =
        height +
        ((key === gameTarget ? 0.95 : 0) - height) *
          (presentation.reduced ? 1 : 1 - Math.exp(-dt * 8));
      if (next < 0.001 && key !== gameTarget) relay.relayLifts.delete(key);
      else relay.relayLifts.set(key, next);
    }
  }
  private createWaveField(frame: WaveFrame) {
    const { navigation, audio, selection, presentation, relay, opening } = this.state;
    const { camera, options } = this.runtime;

    const { time, cinematic, shot, trackX, activePlay, play, rhythm } = frame;
    const spectrumPoint = new THREE.Vector3();
    const screenX = (row: number, lane: number) => {
      spectrumPoint
        .set(
          (lane - 2) * COLUMN_SPACING - trackX,
          -4.6,
          (row - 15.5) * ROW_SPACING + navigation.rail.value,
        )
        .project(camera);
      return (spectrumPoint.x + 1) / 2;
    };
    const fieldCache = audio.audioFieldCache;
    fieldCache.clear();
    const field = (row: number, lane: number): number => {
      const key = `${row}:${lane}`;
      const cached = fieldCache.get(key);
      if (cached !== undefined) return cached;
      if (cinematic)
        return cinematicField(
          row,
          lane,
          shot,
          navigation.shoulder.value,
          navigation.laneFocus.value,
        );
      const height =
        archiveWave(
          row + navigation.coordinateOrigin.row,
          lane + navigation.coordinateOrigin.lane,
          selection.scanTime,
        ) * selection.scanBlend;
      const breathing =
        idleWave(
          row + navigation.coordinateOrigin.row,
          lane + navigation.coordinateOrigin.lane,
          time,
        ) * selection.idleGain;
      let pulseHeight = 0;
      if (!cinematic && !presentation.reduced) {
        let ripple = 0;
        for (const p of selection.pulses) {
          const distance = Math.hypot(row - p.row, (lane - p.lane) * 2.2);
          const age = time - p.time;
          ripple +=
            options.selectionPulse(distance, age) *
            (options.deferSelectionPulse ? rippleEnvelope(distance, age) : 1);
        }
        pulseHeight = THREE.MathUtils.clamp(ripple, -0.6, 0.6) * selection.pulseGain;
      }
      const distance = row - navigation.shoulder.value;
      const interactive =
        (height +
          settlingWave(distance, 26.56) * columnStrength(lane, navigation.laneFocus.value)) *
          (1 - audio.flatMix) +
        breathing +
        pulseHeight +
        (activePlay && !presentation.reduced
          ? rhythmDisplacement(
              row,
              lane,
              time,
              play.bands,
              play.strength,
              rhythm,
              screenX(row, lane),
            )
          : 0) +
        (audio.audioBands && !presentation.reduced
          ? audioWave(
              row + navigation.coordinateOrigin.row,
              lane + navigation.coordinateOrigin.lane,
              time,
              audio.audioBands,
            ) * audio.audioGain
          : 0) +
        (relay.relayLifts.get(cellKey({ row, lane })) ?? 0);
      // 24.9 秒尚未开始选档肩波；将同一阵列平滑接回交互波形。
      const result =
        opening.openingMix > 0
          ? THREE.MathUtils.lerp(
              interactive,
              cinematicField(
                row,
                lane,
                opening.openingFieldTime,
                navigation.shoulder.value,
                navigation.laneFocus.value,
              ),
              opening.openingMix,
            )
          : interactive;
      fieldCache.set(key, result);
      return result;
    };
    return field;
  }
  private updateSelection(wave: WaveFrame, field: SelectionFrame['field']): SelectionFrame {
    const { selection, presentation, audio } = this.state;
    const { options } = this.runtime;

    const { chosen, selectedRow, selectedLane, cinematic, dt, blend } = wave;
    const selectedBase = chosen.y + field(selectedRow, selectedLane);
    if (!cinematic) {
      if (selection.returnY !== null && selection.rotation !== 0) {
        selection.lift.value = selection.returnY - selectedBase;
        selection.lift.velocity = 0;
      } else {
        selection.returnY = null;
        damp(
          selection.lift,
          selection.targetDetail
            ? INSPECTION_LIFT
            : selection.outgoing.some(
                  (o) =>
                    o.returnY !== null &&
                    o.cell.lane === selectedLane &&
                    Math.abs(o.cell.row - selectedRow) < 5,
                )
              ? 0
              : 0.4 * presentation.targetReveal * (1 - audio.flatMix),
          presentation.reduced
            ? 35
            : options.deferSelectionPulse && !selection.targetDetail && selection.lift.value < 0.4
              ? 7.6
              : 4.2,
          dt,
        );
      }
    }
    const cameraTarget = selection.targetDetail
      ? ease((selection.lift.value - 0.8) / 2.4)
      : selection.returnY !== null
        ? selection.detail
        : ease((selection.lift.value - 0.4) / (INSPECTION_LIFT - 0.4));
    selection.detail = cinematic
      ? cinematic.zoom
      : THREE.MathUtils.lerp(selection.detail, cameraTarget, blend);
    const detail = selection.detail;
    return { ...wave, field, selectedBase, detail };
  }
  private updateDecryption(frame: SelectionFrame) {
    const { selection, presentation } = this.state;
    const { assets } = this.runtime;

    const { dt, detail, cinematic, shot } = frame;
    selection.decryption.update(
      dt,
      detail > 0.78 && selection.lift.value > 3.3,
      presentation.reduced,
      cinematic ? shot + 5 : undefined,
    );
    assets.appearance.apply(assets.model, ease(selection.lift.value / 0.4));
    assets.appearance.setClarity(assets.model, selection.decryption.clarity);
  }
  private updateCards(frame: SelectionFrame) {
    const { presentation, selection, navigation } = this.state;
    const { assets, scene } = this.runtime;

    const {
      time,
      dt,
      cinematic,
      shot,
      workspaceEntry,
      trackX,
      field,
      hoverLift,
      selectedBase,
      selectedRow,
      selectedLane,
      detail,
      indexDim,
      chosen,
    } = frame;
    // 原时间轴 26.92～27.76 秒：阵列横移进入白色区域。
    const entry = cinematic ? ease((shot - 21.9) / 0.86) : presentation.reveal;
    const entranceTime = THREE.MathUtils.clamp((shot - 21.92) / 0.75, 0, 1);
    const entryZ = workspaceEntry
      ? 0
      : cinematic
        ? -23 * (1 - entranceTime) ** 2
        : -28 * (1 - entry);
    for (let i = selection.outgoing.length - 1; i >= 0; i--) {
      const o = selection.outgoing[i];
      const p = this.runtime.cellPosition(o.cell);
      const baseY = p.y + field(o.cell.row, o.cell.lane);
      o.group.rotation.y = returnStep(o.group.rotation.y, dt, presentation.reduced);
      if (o.returnY !== null) {
        o.lift.value = o.returnY - baseY;
        o.lift.velocity = 0;
        if (o.group.rotation.y === 0) o.returnY = null;
      } else damp(o.lift, 0, presentation.reduced ? 35 : 4.5, dt);
      o.group.position.set(
        p.x - trackX,
        baseY + o.lift.value + hoverLift(o.cell) - this.presentationDrop(o.cell),
        p.z + entryZ + navigation.rail.value,
      );
      const quality = ease(o.lift.value / 0.4);
      assets.appearance.apply(o.group, quality);
      assets.appearance.setTheme(
        o.group,
        presentation.theme.sample(o.cell, time),
        indexDim(o.lift.value),
      );
      o.clarity = presentation.reduced ? 0 : o.clarity * Math.exp(-dt * 9);
      assets.appearance.setClarity(o.group, o.clarity);
      const { row, lane } = o.cell;
      o.group.rotation.x =
        (field(row + 0.5, lane) - field(row - 0.5, lane)) * 0.024 * (1 - detail) * (1 - quality);
      if (o.lift.value < 0.0001 && Math.abs(o.group.rotation.y) < 0.0001) {
        scene.remove(o.group);
        assets.appearance.dispose(o.group);
        selection.outgoing.splice(i, 1);
      }
    }
    if (
      selection.pendingPulse &&
      !cinematic &&
      !selection.targetDetail &&
      presentation.targetReveal
    ) {
      const selectedY = selectedBase + selection.lift.value;
      const oldCardsLower = selection.outgoing.every(
        (old) =>
          old.cell.lane !== selectedLane ||
          Math.abs(old.cell.row - selectedRow) > 4 ||
          old.group.position.y + 0.015 < selectedY,
      );
      // 新档案触发波浪：先完成大部分抬升，待附近返回档案降至下方再向外发出脉冲。
      if (selection.lift.value >= 0.35 && selection.returnY === null && oldCardsLower) {
        if (!presentation.reduced) this.runtime.emitPulse(selection.pendingPulse);
        selection.pendingPulse = null;
      }
    }
    assets.appearance.setTheme(
      assets.model,
      presentation.theme.sample(navigation.selectedCell, time),
      indexDim(selection.lift.value),
    );
    assets.model.position.set(
      chosen.x - trackX,
      chosen.y +
        field(selectedRow, selectedLane) +
        selection.lift.value +
        hoverLift(navigation.selectedCell) -
        this.presentationDrop(navigation.selectedCell),
      chosen.z + entryZ + navigation.rail.value,
    );
    // 抽取只改变高度，构图调整由相机负责。
    assets.model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) - field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - detail) *
        (1 - ease(selection.lift.value / 0.4)),
      cinematic ? 0 : selection.rotation,
      0,
    );
    return entryZ;
  }
  private updateCamera(frame: SelectionFrame): CameraFrame {
    const { presentation, interaction, opening, navigation } = this.state;
    const { options, assets, camera, scene } = this.runtime;

    const { dt, cinematic, workspaceEntry, shot, referenceCinematic, detail } = frame;
    // 第 787 帧测量：横向边缘 (382,-204)，相邻行 (78,38)。
    // 用标签竖边约束高度；档案底部被遮挡，不能用可见片段标定视场角。
    // 工作区入场始终以最终交互构图为目标，原镜头仅供原时间轴使用。
    const cameraShot = workspaceEntry ? 29.1 : shot;
    const orbit = ease((cameraShot - 22.6) / 1.6);
    const settle = ease((cameraShot - 24.25) / 2.25);
    const yaw = THREE.MathUtils.degToRad(89 - 22 * orbit - 8 * settle);
    const elevation = THREE.MathUtils.degToRad(
      3 + 40 * ease((cameraShot - 21.96) / 0.22) - 8 * orbit - 16 * settle,
    );
    const span = THREE.MathUtils.lerp(THREE.MathUtils.lerp(10.8, 10.3, orbit), 7.33, settle);
    const responsiveOpening =
      Boolean(cinematic) &&
      options.container.closest<HTMLElement>('[data-layout]')?.dataset.layout === 'opening';
    const openingAspect = responsiveOpening
      ? options.container.clientWidth / options.container.clientHeight / (16 / 9)
      : 1;
    const openingSpan = (value: number) => value / Math.min(1, openingAspect);
    const distance = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(28 + 7 * orbit, 140, settle),
      72,
      detail,
    );
    const arrayAim = new THREE.Vector3(
      -1.091,
      THREE.MathUtils.lerp(-2.55 + 0.4 * orbit, -0.045, settle),
      THREE.MathUtils.lerp(2.48, 0.481, settle),
    );
    const cameraAim = arrayAim.clone();
    const viewDirection = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    if (referenceCinematic) {
      const earlyTurn = ease((shot - 27.3) / 1.3);
      const finalTurn = ease((shot - 28.6) / 5.4);
      const shotYaw = yaw - THREE.MathUtils.degToRad(9 * earlyTurn + 32 * finalTurn);
      const shotElevation = elevation - THREE.MathUtils.degToRad(1.5 * earlyTurn + 3.7 * finalTurn);
      viewDirection.set(
        -Math.sin(shotYaw) * Math.cos(shotElevation),
        Math.sin(shotElevation),
        Math.cos(shotYaw) * Math.cos(shotElevation),
      );
    } else {
      viewDirection.lerp(new THREE.Vector3(-0.277, 0.238, 0.931), detail).normalize();
    }
    if (referenceCinematic) {
      const pan = ease((shot - 25.4) / 0.95);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      cameraAim.addScaledVector(right, -2.05 * (1 - pan) * ease((shot - 24.2) / 0.8));
    }
    if (referenceCinematic && shot >= 25.05 && shot <= 27.3) {
      // 第 760～785 帧：相机将同一实体列从右侧带到选中位置，邻近波峰同步回落。
      const pan = ease((shot - 25.4) / 1.05);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
      const pixelScale = 1080 / openingSpan(span);
      const anchorAim = assets.model.position.clone().add(new THREE.Vector3(-2.5, 3.7, 0));
      anchorAim.addScaledVector(
        right,
        (-(THREE.MathUtils.lerp(840, 518, pan) - 960) * openingAspect) / pixelScale,
      );
      anchorAim.addScaledVector(up, -(540 - THREE.MathUtils.lerp(340, 288, pan)) / pixelScale);
      cameraAim.lerp(anchorAim, ease((shot - 25.05) / 0.35));
    }
    if (referenceCinematic && shot > 27.3) {
      const close = ease((shot - 27.3) / 6.7);
      const extractionCamera = ease((shot - 27.3) / 1.25);
      const screenX = THREE.MathUtils.lerp(518 - 98 * extractionCamera, 618, close);
      const screenY = THREE.MathUtils.lerp(296 + 34 * extractionCamera, 287, close);
      const pixelScale = 1080 / openingSpan(THREE.MathUtils.lerp(span, 5.9, detail));
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
      const anchorAim = assets.model.position.clone().add(new THREE.Vector3(-2.5, 3.7, 0));
      anchorAim.addScaledVector(right, (-(screenX - 960) * openingAspect) / pixelScale);
      anchorAim.addScaledVector(up, -(540 - screenY) / pixelScale);
      cameraAim.lerp(anchorAim, ease((shot - 27.3) / 0.5));
    }
    const framing = archiveFraming(
      options.container.clientWidth,
      options.container.clientHeight,
      span,
      detail,
      options.container.closest<HTMLElement>('[data-layout]')?.dataset.layout === 'compact',
    );
    if (!referenceCinematic) {
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
      const width = options.container.clientWidth,
        height = options.container.clientHeight;
      const pixelScale = height / framing.span;
      if (framing.portrait) {
        // 预览相机独立于实时抬升、波浪和轨道；跟随模型位置会在视觉上抵消这些运动。
        const previewAim = new THREE.Vector3(0, -4.6 + settlingWave(0, 26.56) + 0.4 + 1.85, -2.17);
        previewAim.addScaledVector(up, ((framing.previewY - 0.5) * height) / pixelScale);
        cameraAim.copy(previewAim);
      }
      const detailAim = assets.model.position.clone().add(new THREE.Vector3(0, 1.85, 0));
      detailAim.addScaledVector(right, ((0.5 - framing.detailX) * width) / pixelScale);
      detailAim.addScaledVector(up, ((framing.detailY - 0.5) * height) / pixelScale);
      cameraAim.lerp(detailAim, detail);
    }
    const cameraPosition = cameraAim.clone().addScaledVector(viewDirection, distance);
    let cameraSpan = referenceCinematic
      ? openingSpan(THREE.MathUtils.lerp(span, 5.9, detail))
      : framing.span;
    if (workspaceEntry) {
      const pose = archiveEntryCamera(shot - 21.9, {
        yaw,
        elevation,
        distance,
        span: framing.span,
        aim: [cameraAim.x, cameraAim.y, cameraAim.z],
      });
      cameraAim.fromArray(pose.aim);
      cameraPosition.fromArray(pose.position);
      cameraSpan = pose.span;
    }
    if (!cinematic && !presentation.reduced && !presentation.uiOnlyParallax) {
      // 接回鼠标视差时也沿用衔接进度，避免入场结束瞬间偏移。
      cameraPosition.x += interaction.pointer.x * 0.12 * (1 - opening.openingMix);
      cameraPosition.y -= interaction.pointer.y * 0.12 * (1 - opening.openingMix);
    }
    const cameraBlend =
      cinematic || opening.openingSnap ? 1 : (opening.openingCameraBlend ?? 1 - Math.exp(-dt * 5));
    camera.position.lerp(cameraPosition, cameraBlend);
    navigation.cameraAim.lerp(cameraAim, cameraBlend);
    camera.lookAt(navigation.cameraAim);
    camera.fov = THREE.MathUtils.lerp(
      camera.fov,
      THREE.MathUtils.radToDeg(2 * Math.atan(cameraSpan / (2 * distance))),
      cameraBlend,
    );
    opening.openingSnap = false;
    opening.openingCameraBlend = undefined;
    const fog = scene.fog as THREE.Fog;
    // 相机距离变化后位置仍在阻尼过渡，雾范围应跟随实际相机；
    // 否则入场阵列会暂时落在远平面外，产生退出时没有的短暂白屏。
    const renderedDistance = camera.position.distanceTo(navigation.cameraAim);
    const fogTheme = this.runtime.themeAmount;
    fog.near = renderedDistance + THREE.MathUtils.lerp(5 - 4 * fogTheme, -1, detail);
    fog.far = renderedDistance + THREE.MathUtils.lerp(25 - 9 * fogTheme, 12, detail);

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return { fog, responsiveOpening };
  }
  private updateCardInstances(frame: SelectionFrame, entryZ: number, camera: CameraFrame) {
    const { navigation, render, selection, relay, presentation } = this.state;
    const { visibility, assets, scratch } = this.runtime;

    const { time, cinematic, trackX, field, hoverLift, detail, play } = frame;
    const { fog, responsiveOpening } = camera;
    // 本帧实际阻尼相机确定后再构建和压紧实例，命中测试复用同一索引与单元映射。
    const fixed = (Boolean(cinematic) || !navigation.looping) && !responsiveOpening;
    navigation.cells = fixed
      ? Array.from({ length: 160 }, (_, i) => poolCell(i))
      : visibility.update(
          this.runtime.camera,
          fog.far,
          trackX,
          entryZ + navigation.rail.value,
          render.extraCoverage,
        );
    const hidden = new Set(selection.outgoing.map((o) => cellKey(o.cell)));
    hidden.add(cellKey(navigation.selectedCell));
    render.drawnCells = [];
    relay.relayPoints.clear();
    assets.matrixUpdates ??= new InstanceUpdates(assets.instances[0].instanceMatrix);
    if (assets.themeAttribute) assets.themeUpdates ??= new InstanceUpdates(assets.themeAttribute);
    const coverCounts = assets.coverInstances.map(() => 0);
    for (const cell of navigation.cells) {
      const { row, lane } = cell;
      if (hidden.has(cellKey(cell))) continue;
      const x = (lane - 2) * COLUMN_SPACING - trackX;
      const y = -4.6 + field(row, lane) + hoverLift(cell) - this.presentationDrop(cell);
      const z = (row - 15.5) * ROW_SPACING + entryZ + navigation.rail.value;
      if (!fixed && !visibility.intersects(x, y, z)) continue;
      const i = render.drawnCells.length;
      assets.ensureInstanceCapacity(i + 1);
      render.drawnCells.push(cell);
      assets.themeUpdates?.scalar(i, presentation.theme.sample(cell, time));
      const slope = field(row + 0.5, lane) - field(row - 0.5, lane);
      scratch.dummy.position.set(x, y, z);
      scratch.dummy.rotation.set(slope * 0.024 * (1 - detail), 0, 0);
      scratch.dummy.scale.setScalar(1);
      scratch.dummy.updateMatrix();
      if (play.enabled)
        relay.relayPoints.set(cellKey(cell), {
          cell: { ...cell },
          point: new THREE.Vector3(0, 3.5, 0).applyMatrix4(scratch.dummy.matrix),
        });
      assets.matrixUpdates!.set(i * 16, scratch.dummy.matrix.elements);
      const albumIndex = records[fileAtCell(cell)].albumIndex;
      assets.coverInstances[albumIndex].setMatrixAt(
        coverCounts[albumIndex]++,
        scratch.dummy.matrix,
      );
    }
    assets.coverInstances.forEach((cover, albumIndex) => {
      cover.count = coverCounts[albumIndex];
      cover.instanceMatrix.needsUpdate = true;
    });
    const countChanged = assets.instances[0].count !== render.drawnCells.length;
    const matricesChanged = assets.matrixUpdates!.commit();
    for (const inst of assets.instances) {
      inst.count = render.drawnCells.length;
    }
    // 命中测试只使用首个实例表面，其他批次关闭渲染器裁剪，无需逐帧重新计算边界。
    if (matricesChanged || countChanged || !assets.instances[0].boundingSphere)
      assets.instances[0].computeBoundingSphere();
    assets.themeUpdates?.commit();
    return matricesChanged;
  }
  private updateInspection(frame: SelectionFrame) {
    const { selection } = this.state;
    const { assets, options, camera, rendering } = this.runtime;

    const { selectedLane, selectedRow, field, cinematic, detail } = frame;
    let neighborTop = -Infinity;
    const lane = selectedLane,
      row = selectedRow;
    for (let r = row - 5; r <= row + 5; r++) {
      if (r !== row) neighborTop = Math.max(neighborTop, -4.6 + field(r, lane) + 3.76);
    }
    for (const o of selection.outgoing) {
      if (o.cell.lane === lane && Math.abs(o.cell.row - row) <= 5) {
        neighborTop = Math.max(neighborTop, o.group.position.y + 3.76);
      }
    }
    selection.clearance = assets.model.position.y - neighborTop;
    selection.canInspect =
      !cinematic &&
      Boolean(selection.targetDetail) &&
      detail > 0.9 &&
      selection.pulseGain < 0.01 &&
      selection.clearance > 0.3;
    options.container.dataset.inspection =
      selection.returnY !== null
        ? 'aligning'
        : selection.canInspect
          ? 'ready'
          : selection.targetDetail
            ? 'lifting'
            : 'preview';
    const focalPoint = assets.model.position
      .clone()
      .add(new THREE.Vector3(0, 2, 0))
      .applyMatrix4(camera.matrixWorldInverse);
    const bokehUniforms = rendering.bokeh.uniforms as Record<string, { value: number }>;
    bokehUniforms.focus.value = -focalPoint.z;
    bokehUniforms.aperture.value =
      (THREE.MathUtils.lerp(0.0003, 0.0008, detail) * rendering.currentQuality.depthOfField) / 100;
    return bokehUniforms;
  }
  private renderFrame(
    frame: SelectionFrame,
    matricesChanged: boolean,
    fog: THREE.Fog,
    bokehUniforms: Record<string, { value: number }>,
  ) {
    const { render, presentation } = this.state;
    const { rendering, scene, camera, assets } = this.runtime;

    const { cinematic } = frame;
    rendering.renderer.info.reset();
    // 模拟和命中测试始终更新；包括迟到贴图和材质在内的实际输入完全相同时才复用画布。
    const state = render.renderState;
    scene.updateMatrixWorld();
    // 实例缓冲变化已证明画面变化，活动帧不再额外采集材质/矩阵快照，稳定后再比较。
    if (matricesChanged || cinematic) {
      state.invalidate();
    } else {
      state.begin();
      state.floats(
        ...camera.projectionMatrix.elements,
        ...camera.matrixWorldInverse.elements,
        ...camera.position.toArray(),
        fog.near,
        fog.far,
        this.runtime.themeAmount,
        presentation.subduedIndex.value,
        bokehUniforms.focus.value,
        bokehUniforms.aperture.value,
      );
      scene.traverse((object) => {
        state.add(object.id, Number(object.visible));
        if (!(object instanceof THREE.Mesh)) return;
        object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
        object.normalMatrix.getNormalMatrix(object.modelViewMatrix);
        state.floats(
          ...object.modelViewMatrix.elements,
          ...object.normalMatrix.elements,
          ...object.matrixWorld.elements,
        );
        const mat = object.material as THREE.MeshPhysicalMaterial;
        // Three 会在双面透射通道中递增材质版本；这里只追踪应用控制的输入。
        state.add(object.geometry.id, mat.uuid, mat.map?.uuid, mat.map?.version ?? 0);
        state.floats(
          mat.opacity,
          mat.roughness,
          mat.metalness,
          mat.transmission,
          mat.thickness,
          mat.attenuationDistance,
          mat.clearcoat,
          mat.clearcoatRoughness,
          mat.color.r,
          mat.color.g,
          mat.color.b,
          mat.attenuationColor?.r ?? 0,
          mat.attenuationColor?.g ?? 0,
          mat.attenuationColor?.b ?? 0,
        );
        for (const name of ['appearance', 'glassClarity', 'themeAmount', 'subduedIndex'])
          state.floats(object.userData[name]?.value ?? 0);
        if (object instanceof THREE.InstancedMesh)
          state.add(
            object.count,
            object.instanceMatrix.version,
            assets.themeAttribute?.version ?? 0,
          );
      });
      if (!state.end()) {
        render.reusedFrames++;
        return;
      }
    }
    render.renderedFrames++;
    rendering.renderer.shadowMap.needsUpdate = true;
    if (presentation.superPerformance) rendering.renderer.render(scene, camera);
    else rendering.composer.render();
  }
}
