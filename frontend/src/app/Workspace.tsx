import { useMemo, useRef, useState } from 'react';
import { demoAlbums } from '../features/music-library/album-data.ts';
import { createPersonalLibraryClient } from '../services/music/personal-library.ts';
import { createFootprintClient } from '../services/music/footprint.ts';
import { WorkspaceView } from './WorkspaceView.tsx';
import { useWorkspaceNavigation } from './hooks/use-workspace-navigation.ts';
import { useArchiveKeyboard } from './hooks/use-archive-keyboard.ts';
import { useWorkspaceScene } from './hooks/use-workspace-scene.ts';
import type { PlayerCommands, WorkspaceProps, WorkspaceRefs } from './types.ts';
export type { WorkspaceProps } from './types.ts';

export default function Workspace(props: WorkspaceProps) {
  const { player, personalLibrary, footprintClient, loadScene, initialIndex = 0 } = props;
  const refs: WorkspaceRefs = {
    archive: useRef(null),
    sceneContainer: useRef(null),
    library: useRef(null),
    playerView: useRef(null),
    settings: useRef(null),
    user: useRef(null),
    footprint: useRef(null),
    inputRef: useRef(null),
  };
  const [selected, setSelected] = useState(demoAlbums[initialIndex]);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const client = useMemo(() => personalLibrary ?? createPersonalLibraryClient(), [personalLibrary]);
  const footprints = useMemo(() => footprintClient ?? createFootprintClient(), [footprintClient]);
  const navigation = useWorkspaceNavigation({
    routedPage: props.page,
    onNavigate: props.onNavigate,
    library: refs.library,
  });
  const archiveScene = useWorkspaceScene({
    player,
    loadScene,
    page: navigation.page,
    expanded,
    settingsOpen,
    refs,
  });
  const { playerView } = refs;
  const playerCommands = useMemo<PlayerCommands>(
    () => ({
      play: (track) => playerView.current?.play(track) ?? Promise.resolve(),
      enqueue: (track) => playerView.current?.enqueue(track),
      choosePlaylist: (track) => playerView.current?.choosePlaylist(track) ?? Promise.resolve(),
      closeQueue: () => playerView.current?.closeQueue(),
      replaceAndPlay: (tracks) => playerView.current?.replaceAndPlay(tracks) ?? Promise.resolve(),
      syncLiked: () => playerView.current?.syncLiked() ?? Promise.resolve(),
    }),
    [playerView],
  );
  useArchiveKeyboard({
    ...refs,
    page: navigation.page,
    scene: archiveScene.scene,
    show: navigation.show,
  });
  return (
    <WorkspaceView
      workspace={props}
      refs={refs}
      navigation={navigation}
      archiveScene={archiveScene}
      playerCommands={playerCommands}
      client={client}
      footprints={footprints}
      selected={selected}
      onSelected={setSelected}
      expanded={expanded}
      onExpandedChanged={setExpanded}
      onSettingsOpenChanged={setSettingsOpen}
    />
  );
}
