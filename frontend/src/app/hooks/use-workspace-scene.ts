import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readPlaybackMotion, savePlaybackMotion } from '../../features/settings/playback-motion';
import { demoAlbums } from '../../features/music-library/album-data.ts';
import { mountArchiveScene, type ArchiveEntryPhase } from '../../graphics/archive/scene-host.ts';
import { useReducedMotion } from '../../shared/react/hooks.ts';
import type { WorkspaceProps, WorkspaceRefs, WorkspaceScene } from '../types.ts';
import type { WorkspacePage } from '../routes.ts';

export function useWorkspaceScene({
  player,
  loadScene,
  page,
  expanded,
  settingsOpen,
  refs,
}: {
  player: WorkspaceProps['player'];
  loadScene: WorkspaceProps['loadScene'];
  page: WorkspacePage;
  expanded: boolean;
  settingsOpen: boolean;
  refs: Pick<WorkspaceRefs, 'sceneContainer' | 'library'>;
}) {
  const { sceneContainer, library } = refs;
  const reduced = useReducedMotion();
  const [playbackMotion, setPlaybackMotion] = useState(readPlaybackMotion);
  const changePlaybackMotion = (enabled: boolean) => {
    savePlaybackMotion(enabled);
    setPlaybackMotion(enabled);
  };
  const [scene, setScene] = useState<WorkspaceScene | null>(null);
  const [entryPhase, setEntryPhase] = useState<ArchiveEntryPhase>('loading');
  // 隐藏档案墙暂停入场时，仍允许其他页面的共享导航和播放器交互。
  const pageEntryPhase = page === 'archive' ? entryPhase : 'ready';
  const entering = pageEntryPhase !== 'ready' && pageEntryPhase !== 'failed';
  const sceneInputs = useRef({ loadScene, reduced });
  sceneInputs.current = { loadScene, reduced };
  useLayoutEffect(() => {
    if (!sceneContainer.current) return;
    const host = mountArchiveScene(sceneContainer.current, {
      resetAudioBands: () => player.resetAudioBands?.(),
      readAudioBands: (now) =>
        player.readAudioBands?.(now) ?? { low: 0, mid: 0, high: 0, activity: 0 },
      audioEnabled: readPlaybackMotion(),
      entry: true,
      onEntryPhase: setEntryPhase,
      reduced: sceneInputs.current.reduced,
      initialRecord: 16,
      covers: demoAlbums.map((album) => album.coverUrl),
      loadScene: sceneInputs.current.loadScene,
      afterUpdate: (visibility, now) => library.current?.afterUpdate(visibility, now) ?? true,
      onSelect: (index, cell) => library.current?.selectRecord(index, cell ? { cell } : undefined),
      onNavigate: (axis, direction) => library.current?.navigate(axis, direction),
    });
    setScene(host);
    return () => host.destroy();
  }, [loadScene, player, sceneContainer, library]);
  useEffect(() => {
    scene?.setVisible(page === 'archive' && !expanded && !settingsOpen);
  }, [scene, page, expanded, settingsOpen]);
  useEffect(() => {
    scene?.setReduced(reduced);
  }, [scene, reduced]);
  useEffect(() => {
    scene?.setAudioEnabled(playbackMotion);
  }, [scene, playbackMotion]);
  return { scene, entryPhase, pageEntryPhase, entering, playbackMotion, changePlaybackMotion };
}
