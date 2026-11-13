import * as THREE from 'three';
import { ThemeWave } from './theme-motion';
import { quietBands, RhythmMotion, type MusicBands, type RhythmStyle } from './archive-play-motion';
import { ArchiveDrag, type ArchivePlaneMomentum, type DragPosition } from './archive-drag';
import { DecryptionController } from './decryption';
import { RenderState } from './render-state';
import type { ArchiveCell } from './archive-loop';

export type ArchivePlayfield = {
  enabled: boolean;
  bands: MusicBands;
  strength: number;
  flatten: number;
  target: string | null;
  breathing: boolean;
};

// 只创建每个场景独立的逻辑状态，不创建模型、渲染器或后处理资源。
export function createSceneState() {
  return {
    lifecycle: {
      disposed: false,
      loaded: false,
    },
    presentation: {
      presence: 1,
      presenceTarget: 1,
      uiOnlyParallax: false,
      theme: new ThemeWave(),
      subduedIndex: { value: 0 },
      selectedIndexOnly: false,
      superPerformance: false,
      reduced: false,
      reveal: 0,
      targetReveal: 0,
    },
    audio: {
      playfield: {
        enabled: false,
        bands: quietBands(),
        strength: 1,
        flatten: 0,
        target: null,
        breathing: true,
      } as ArchivePlayfield,
      flatMix: 0,
      audioGain: 0,
      audioBands: undefined as MusicBands | undefined,
      audioFieldCache: new Map<string, number>(),
      rhythm: new RhythmMotion(),
      rhythmStyle: 'legacy' as RhythmStyle,
    },
    relay: {
      relayLifts: new Map<string, number>(),
      relayPoints: new Map<string, { cell: ArchiveCell; point: THREE.Vector3 }>(),
      relayActive: false,
    },
    render: {
      renderState: new RenderState(),
      renderedFrames: 0,
      reusedFrames: 0,
      drawnCells: [] as ArchiveCell[],
      extraCoverage: false,
    },
    navigation: {
      cells: [] as ArchiveCell[],
      selectedCell: { lane: 2, row: 12 } as ArchiveCell,
      looping: false,
      coordinateOrigin: { lane: 0, row: 0 } as ArchiveCell,
      rail: { value: 0, velocity: 0 },
      shoulder: { value: 12, velocity: 0 },
      laneFocus: { value: 2, velocity: 0 },
      columnCamera: { value: 0, velocity: 0 },
      lastInteraction: 0,
      cameraAim: new THREE.Vector3(),
      selectedSlot: 76,
    },
    selection: {
      lift: { value: 0, velocity: 0 },
      returnY: null as number | null,
      canInspect: false,
      clearance: 0,
      pulseGain: 1,
      idleGain: 0,
      scanTime: 29.1,
      scanBlend: 0,
      outgoing: [] as {
        group: THREE.Group;
        slot: number;
        cell: ArchiveCell;
        lift: { value: number; velocity: number };
        returnY: number | null;
        clarity: number;
      }[],
      pulses: [] as { row: number; lane: number; time: number }[],
      pendingPulse: null as ArchiveCell | null,
      detail: 0,
      targetDetail: 0,
      rotation: 0,
      targetRotation: 0,
      decryption: new DecryptionController(),
    },
    interaction: {
      pointer: new THREE.Vector2(),
      dragging: false,
      hoverCell: null as ArchiveCell | null,
      hoverLifts: new Map<string, number>(),
      archiveDrag: new ArchiveDrag(),
      dragTrack: null as DragPosition | null,
      navigatingDrag: false,
      archiveMomentum: null as { motion: ArchivePlaneMomentum; time: number } | null,
      holdingArchive: false,
    },
    timing: {
      last: 0,
      clock: 0,
    },
    opening: {
      openingMix: 0,
      openingSnap: false,
      openingCameraBlend: undefined as number | undefined,
      openingProgress: 0,
      openingFieldTime: 24.9,
    },
    callbacks: {
      onRelayPick: undefined as ((key: string | null) => void) | undefined,
      onCoverUpdate: undefined as (() => void) | undefined,
      onSelect: undefined as ((index: number, cell?: ArchiveCell) => void) | undefined,
      onHover: undefined as ((index: number | null) => void) | undefined,
      onNavigate: undefined as ((axis: 'row' | 'lane', direction: number) => void) | undefined,
    },
  };
}
export type SceneState = ReturnType<typeof createSceneState>;
