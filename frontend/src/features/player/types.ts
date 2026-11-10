import type { MouseEvent } from 'react';
import type { PlayerState } from './player-core.ts';

export type PlayerPreview = {
  title: string;
  artist: string;
  coverUrl: string;
  tracks: readonly { title: string; duration: string }[];
};

export interface PlayerDisplay {
  state: PlayerState;
  expanded: boolean;
  playerVisible: boolean;
  queueOpen: boolean;
  liked: boolean;
  playerLikeDisabled: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  volumeValue: number;
  queueCount: string;
}

export interface PlayerDisplayActions {
  onFooterClick(event: MouseEvent<HTMLElement>): void;
  setExpanded(open: boolean, restoreFocus?: boolean): void;
  onPlayerLike(): void;
  playPrevious(): void;
  playNext(): void;
  togglePlayback(): void;
  seekToPointer(event: MouseEvent<HTMLButtonElement>): void;
  seek(fraction: number): void;
  changeVolume(value: number): void;
  onPlayerQueueToggle(): void;
}
