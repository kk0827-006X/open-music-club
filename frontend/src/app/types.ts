import type { RefObject } from 'react';
import type { WorkspacePage } from './routes.ts';
import type { LibraryViewHandle } from '../features/music-library/LibraryView.tsx';
import type { PlayerViewHandle } from '../features/player/PlayerView.tsx';
import type { PlayerController } from '../features/player/player-core.ts';
import type { MusicQueue } from '../features/queue/model.ts';
import type { UserPageHandle } from '../features/user/UserPage.tsx';
import type { SettingsDialogHandle } from '../features/settings/SettingsDialog.tsx';
import type { FootprintPageHandle } from '../features/footprint/FootprintPage.tsx';
import type { createPersonalLibraryClient } from '../services/music/personal-library.ts';
import type { createFootprintClient } from '../services/music/footprint.ts';
import type { mountArchiveScene, ArchiveSceneController } from '../graphics/archive/scene-host.ts';

export interface WorkspaceProps {
  role?: 'admin' | 'user';
  player: PlayerController;
  queue: MusicQueue;
  personalLibrary?: ReturnType<typeof createPersonalLibraryClient>;
  footprintClient?: ReturnType<typeof createFootprintClient>;
  footprintRevision?: number;
  onLogout?: () => Promise<void>;
  loadScene?: () => Promise<ArchiveSceneController>;
  page?: WorkspacePage;
  onNavigate?: (page: WorkspacePage) => void;
  initialIndex?: number;
}

export interface WorkspaceRefs {
  archive: RefObject<HTMLElement | null>;
  sceneContainer: RefObject<HTMLDivElement | null>;
  library: RefObject<LibraryViewHandle | null>;
  playerView: RefObject<PlayerViewHandle | null>;
  settings: RefObject<SettingsDialogHandle | null>;
  user: RefObject<UserPageHandle | null>;
  footprint: RefObject<FootprintPageHandle | null>;
  inputRef: RefObject<HTMLInputElement | null>;
}

// 普通播放动作只在调用时读取当前视图，不捕获已卸载的 PlayerView 实例。
export type PlayerCommands = Pick<
  PlayerViewHandle,
  'play' | 'enqueue' | 'choosePlaylist' | 'closeQueue' | 'replaceAndPlay' | 'syncLiked'
>;
export type WorkspaceScene = ReturnType<typeof mountArchiveScene>;
export type SongQuery = { term: string; serial: number };
